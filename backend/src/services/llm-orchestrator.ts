import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { getAllSettings } from './db.js';
import { LLMError } from '../errors.js';

const clients = new Map<string, OpenAI>();

function buildAvailableProviders(settings: Record<string, any>) {
  return Object.entries(config.providers).map(([key, value]) => ({
    id: key,
    name: value.name,
    model: settings[`llm.providers.${key}.model`] || value.model,
    configured: !!value.apiKey,
    enabled: settings[`llm.providers.${key}.enabled`] !== false,
  }));
}

async function getClient(providerName: string, settings?: Record<string, any>): Promise<OpenAI> {
  if (!clients.has(providerName)) {
    const builtinCfg = (config.providers as any)[providerName];
    const resolvedSettings = settings || await getAllSettings();

    const baseURL = resolvedSettings[`llm.providers.${providerName}.baseURL`] || builtinCfg?.baseURL;
    const apiKey = builtinCfg?.apiKey || '';

    if (!baseURL || !apiKey) {
      throw new Error(`Provider ${providerName} not configured`);
    }

    clients.set(providerName, new OpenAI({ baseURL, apiKey, timeout: 120_000 }));
  }
  return clients.get(providerName)!;
}

export function clearClientCache(): void {
  clients.clear();
  logger.info('LLM client cache cleared');
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  providerName: string = ''
): Promise<T> {
  const delays = [1000, 2000, 4000];
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === retries - 1) throw err;
      const delay = delays[attempt] || 4000;
      logger.warn({ provider: providerName, attempt: attempt + 1, delay }, 'Retrying LLM call');
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}

export async function generateCompletion(
  systemPrompt: string,
  userPrompt: string,
  preferredProvider?: string,
  overrides?: { temperature?: number; maxTokens?: number }
): Promise<{ content: string; provider: string }> {
  const settings = await getAllSettings();

  const fallbackOrder: string[] = settings['llm.fallbackOrder'] || ['cerebras', 'groq', 'openrouter'];
  const temperature = overrides?.temperature ?? settings['llm.temperature'] ?? 0.3;
  const maxTokens = overrides?.maxTokens ?? settings['llm.maxTokens'] ?? 4096;

  const order = preferredProvider
    ? [preferredProvider, ...fallbackOrder.filter((p) => p !== preferredProvider)]
    : fallbackOrder;

  const providerErrors: Array<{ provider: string; error: string }> = [];

  for (const providerName of order) {
    const builtinCfg = (config.providers as any)[providerName];
    const enabled = settings[`llm.providers.${providerName}.enabled`];
    if (enabled === false) continue;

    if (!builtinCfg?.apiKey) {
      logger.debug({ provider: providerName }, 'Skipping provider (no API key)');
      continue;
    }

    const model = settings[`llm.providers.${providerName}.model`] || builtinCfg?.model;

    try {
      const client = await getClient(providerName, settings);
      logger.info({ provider: providerName, model }, 'Calling LLM');

      const content = await retryWithBackoff(async () => {
        const response = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature,
          max_tokens: maxTokens,
        });

        const text = response.choices[0]?.message?.content;
        if (!text) throw new Error('Empty response from LLM');
        return text;
      }, 3, providerName);

      return { content, provider: providerName };
    } catch (err: any) {
      const errorMsg = err.message || String(err);
      providerErrors.push({ provider: providerName, error: errorMsg });
      logger.warn({ provider: providerName, err }, 'LLM call failed, trying next provider');
    }
  }

  throw new LLMError('All LLM providers failed', providerErrors);
}

export async function getAvailableProviders() {
  const settings = await getAllSettings();
  return buildAvailableProviders(settings);
}
