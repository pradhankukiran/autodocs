import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  wikiUrl: process.env.WIKI_URL || 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  wikiApiToken: process.env.WIKI_API_TOKEN || '',
  reposDir: process.env.REPOS_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../repos'),
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
      model: 'openai/gpt-oss-120b',
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
