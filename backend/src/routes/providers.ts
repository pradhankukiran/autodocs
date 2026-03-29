import { Router, Request, Response, NextFunction } from 'express';
import { getAvailableProviders, clearClientCache } from '../services/llm-orchestrator.js';
import { checkConnection } from '../services/wiki-client.js';
import { getAllSettings, setSetting } from '../services/db.js';
import { requireAdminApiKey } from '../middleware/admin-auth.js';
import { validateBody, updateSettingsSchema } from '../middleware/validation.js';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;
function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export const providersRouter = Router();
providersRouter.use(requireAdminApiKey);

// List available LLM providers
providersRouter.get('/', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getAvailableProviders());
}));

// Check Wiki.js connection
providersRouter.get('/wiki-status', asyncHandler(async (_req: Request, res: Response) => {
  const connected = await checkConnection();
  res.json({ connected });
}));

// GET settings
providersRouter.get('/settings', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getAllSettings());
}));

// PUT settings
providersRouter.put('/settings', validateBody(updateSettingsSchema), asyncHandler(async (req: Request, res: Response) => {
  const body = req.body;
  let llmChanged = false;

  for (const [key, value] of Object.entries(body)) {
    await setSetting(key, value);
    if (key.startsWith('llm.')) llmChanged = true;
  }

  // Invalidate cached LLM clients when LLM config changes
  if (llmChanged) {
    clearClientCache();
  }

  res.json(await getAllSettings());
}));

// GET LLM config (without API keys)
providersRouter.get('/llm-config', asyncHandler(async (_req: Request, res: Response) => {
  const settings = await getAllSettings();
  res.json({
    temperature: settings['llm.temperature'] ?? 0.3,
    maxTokens: settings['llm.maxTokens'] ?? 4096,
    fallbackOrder: settings['llm.fallbackOrder'] ?? ['cerebras', 'groq', 'openrouter'],
    providers: await getAvailableProviders(),
  });
}));

// Helper for other modules
export async function getSettings(): Promise<Record<string, any>> {
  return getAllSettings();
}
