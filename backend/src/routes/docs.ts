import { Router, Request, Response } from 'express';
import { getRepoData } from './repos.js';
import { generateDocs, GenerationProgress, GenerationOptions } from '../services/doc-generator.js';
import { CodeTargetKey, CODE_TARGETS } from '../prompts/code-examples.js';
import { logger } from '../utils/logger.js';

export const docsRouter = Router();

// Store generated OpenAPI specs in memory
const openApiSpecs = new Map<string, object>();

// Trigger doc generation (returns SSE stream)
docsRouter.post('/generate', async (req: Request, res: Response) => {
  const { repoId, provider, codeTargets } = req.body;

  if (!repoId) {
    return res.status(400).json({ error: 'repoId is required' });
  }

  const repoData = getRepoData(repoId);
  if (!repoData) {
    return res.status(404).json({ error: 'Repo not found. Ingest it first via POST /api/repos' });
  }

  const validProviders = ['cerebras', 'groq', 'openrouter'];
  if (provider && !validProviders.includes(provider)) {
    return res.status(400).json({ error: `Invalid provider: ${provider}. Valid: ${validProviders.join(', ')}` });
  }

  // Validate codeTargets if provided
  const validCodeTargets = Object.keys(CODE_TARGETS);
  if (codeTargets && Array.isArray(codeTargets)) {
    const invalid = codeTargets.filter((t: string) => !validCodeTargets.includes(t));
    if (invalid.length > 0) {
      return res.status(400).json({
        error: `Invalid code targets: ${invalid.join(', ')}`,
        validTargets: validCodeTargets,
      });
    }
  }

  const generationOptions: GenerationOptions = {
    provider: provider || 'cerebras',
    codeTargets: codeTargets as CodeTargetKey[] | undefined,
  };

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (data: GenerationProgress) => {
    res.write(`event: ${data.step}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent({
      step: 'parsing',
      progress: 5,
      message: `Found ${repoData.routes.length} routes in ${repoData.ingest.expressFiles.length} files`,
    });

    const { openApiSpec, pagesCreated } = await generateDocs(
      repoData.ingest.name,
      repoData.routes,
      repoId,
      generationOptions,
      sendEvent
    );

    // Store the spec
    openApiSpecs.set(repoId, openApiSpec);
  } catch (err: any) {
    logger.error({ err }, 'Doc generation failed');
    sendEvent({
      step: 'error',
      progress: 0,
      message: err.message || 'Generation failed',
    });
  }

  res.end();
});

// Get OpenAPI spec for a repo (used by Scalar playground)
docsRouter.get('/openapi/:repoId', (req: Request, res: Response) => {
  const repoId = Array.isArray(req.params.repoId) ? req.params.repoId[0] : req.params.repoId;
  const spec = openApiSpecs.get(repoId);
  if (!spec) {
    return res.status(404).json({ error: 'OpenAPI spec not found. Generate docs first.' });
  }
  res.json(spec);
});
