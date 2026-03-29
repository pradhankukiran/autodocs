import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

function parseCsv(input: string | undefined): string[] {
  return (input || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBoolean(input: string | undefined, fallback: boolean): boolean {
  if (input === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(input.trim().toLowerCase());
}

function parseInteger(input: string | undefined, fallback: number): number {
  if (input === undefined || input.trim() === '') return fallback;
  const value = Number.parseInt(input, 10);
  return Number.isFinite(value) ? value : fallback;
}

function parseProcessMode(input: string | undefined): 'all' | 'server' | 'worker' {
  const normalized = (input || 'all').trim().toLowerCase();
  if (normalized === 'server' || normalized === 'worker') {
    return normalized;
  }

  return 'all';
}

const nodeEnv = process.env.NODE_ENV || 'development';

export const config = {
  nodeEnv,
  port: parseInt(process.env.PORT || '4000', 10),
  wikiUrl: process.env.WIKI_URL || 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  corsOrigins: parseCsv(process.env.CORS_ORIGINS),
  wikiApiToken: process.env.WIKI_API_TOKEN || '',
  adminApiKey: process.env.ADMIN_API_KEY || '',
  allowLocalRepoPaths: parseBoolean(process.env.ALLOW_LOCAL_REPO_PATHS, nodeEnv !== 'production'),
  databaseUrl: process.env.DATABASE_URL || process.env.APP_DATABASE_URL || '',
  reposDir: process.env.REPOS_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../repos'),
  dbPath: process.env.DB_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/autodocs.db'),
  appDatabaseUrl: process.env.APP_DATABASE_URL || '',
  appDatabaseSsl: parseBoolean(process.env.APP_DATABASE_SSL, false),
  processMode: parseProcessMode(process.env.AUTODOCS_PROCESS_MODE),
  docJobPollIntervalMs: Math.max(parseInteger(process.env.DOC_JOB_POLL_INTERVAL_MS, 1000), 250),
  openApiServerUrl: process.env.OPENAPI_SERVER_URL || '',
  openApiOauthAuthorizationUrl: process.env.OPENAPI_OAUTH_AUTHORIZATION_URL || '',
  providers: {
    cerebras: {
      name: 'Cerebras',
      baseURL: 'https://api.cerebras.ai/v1',
      apiKey: process.env.CEREBRAS_API_KEY || '',
      model: 'gpt-oss-120b',
    },
    groq: {
      name: 'Groq',
      baseURL: 'https://api.groq.com/openai/v1/',
      apiKey: process.env.GROQ_API_KEY || '',
      model: 'llama-3.3-70b-versatile',
    },
    openrouter: {
      name: 'OpenRouter',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY || '',
      model: 'gpt-oss-120b',
    },
  },
  defaultProvider: (process.env.DEFAULT_LLM_PROVIDER || 'cerebras') as 'cerebras' | 'groq' | 'openrouter',
};
