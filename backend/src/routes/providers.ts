import { Router, Request, Response } from 'express';
import { getAvailableProviders } from '../services/llm-orchestrator.js';
import { checkConnection } from '../services/wiki-client.js';

export const providersRouter = Router();

// In-memory settings store
const settings: Record<string, any> = {
  defaultRenderer: 'rapidoc',
  codeLanguages: ['javascript-fetch', 'python-requests', 'curl'],
  httpClient: 'fetch',
  authDisplay: 'bearer',
};

// List available LLM providers
providersRouter.get('/', (_req: Request, res: Response) => {
  res.json(getAvailableProviders());
});

// Check Wiki.js connection
providersRouter.get('/wiki-status', async (_req: Request, res: Response) => {
  const connected = await checkConnection();
  res.json({ connected });
});

// GET /api/settings — get current settings
providersRouter.get('/settings', (_req: Request, res: Response) => {
  res.json(settings);
});

// PUT /api/settings — update settings
providersRouter.put('/settings', (req: Request, res: Response) => {
  const allowed = ['defaultRenderer', 'codeLanguages', 'httpClient', 'authDisplay'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      settings[key] = req.body[key];
    }
  }
  res.json(settings);
});
