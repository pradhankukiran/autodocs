import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

type ProviderName = 'cerebras' | 'groq' | 'openrouter';

const clients = new Map<string, OpenAI>();

function getClient(provider: ProviderName): OpenAI {
  if (!clients.has(provider)) {
    const cfg = config.providers[provider];
    clients.set(provider, new OpenAI({
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
    }));
  }
  return clients.get(provider)!;
}

const FALLBACK_ORDER: ProviderName[] = ['cerebras', 'groq', 'openrouter'];

export async function generateCompletion(
  systemPrompt: string,
  userPrompt: string,
  preferredProvider?: ProviderName
): Promise<{ content: string; provider: string }> {
  const order = preferredProvider
    ? [preferredProvider, ...FALLBACK_ORDER.filter(p => p !== preferredProvider)]
    : FALLBACK_ORDER;

  for (const providerName of order) {
    const providerConfig = config.providers[providerName];
    if (!providerConfig.apiKey) {
      logger.debug({ provider: providerName }, 'Skipping provider (no API key)');
      continue;
    }

    try {
      const client = getClient(providerName);
      logger.info({ provider: providerName, model: providerConfig.model }, 'Calling LLM');

      const response = await client.chat.completions.create({
        model: providerConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Empty response from LLM');

      return { content, provider: providerName };
    } catch (err) {
      logger.warn({ provider: providerName, err }, 'LLM call failed, trying next provider');
    }
  }

  throw new Error('All LLM providers failed');
}

export function getAvailableProviders() {
  return Object.entries(config.providers).map(([key, value]) => ({
    id: key,
    name: value.name,
    model: value.model,
    configured: !!value.apiKey,
  }));
}
