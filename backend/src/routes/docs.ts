import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { getRepoData } from '../services/repo-store.js';
import {
  getActiveJobByRepoId,
  getJob,
  getLatestJobByRepoId,
  getOpenApiSpec,
  GenerationJobRow,
  JobProgressEvent,
} from '../services/db.js';
import { requireAdminApiKey } from '../middleware/admin-auth.js';
import { validateBody, generateDocsSchema } from '../middleware/validation.js';
import { docGenerateLimiter } from '../middleware/rate-limit.js';
import { createQueuedDocJob, requeueDocJob } from '../services/doc-job-runner.js';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;
function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export const docsRouter = Router();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildProgressFromJob(job: GenerationJobRow): JobProgressEvent {
  if (job.lastEvent) {
    return job.lastEvent;
  }

  if (job.status === 'completed') {
    return {
      step: 'complete',
      progress: 100,
      message: 'Documentation generated successfully!',
      failedEndpoints: job.failedEndpoints.map(({ endpoint, error }) => ({ endpoint, error })),
    };
  }

  if (job.status === 'failed') {
    return {
      step: 'error',
      progress: job.progress,
      message: job.errorMessage || 'Generation failed',
    };
  }

  if (job.status === 'pending') {
    return {
      step: 'queued',
      progress: job.progress,
      message: 'Queued for generation',
      total: job.totalEndpoints,
    };
  }

  return {
    step: 'generating',
    progress: job.progress,
    message: 'Generation in progress',
    total: job.totalEndpoints,
  };
}

function serializeJob(job: GenerationJobRow) {
  return {
    id: job.id,
    repoId: job.repoId,
    status: job.status,
    provider: job.provider,
    progress: job.progress,
    totalEndpoints: job.totalEndpoints,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    lastEvent: buildProgressFromJob(job),
  };
}

function sendEvent(res: Response, data: JobProgressEvent) {
  res.write(`event: ${data.step}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

docsRouter.post('/generate', requireAdminApiKey, docGenerateLimiter, validateBody(generateDocsSchema), asyncHandler(async (req: Request, res: Response) => {
  const { repoId, provider, codeTargets, temperature, maxTokens } = req.body;

  const repoData = await getRepoData(repoId);
  if (!repoData) {
    return res.status(404).json({ error: 'Repo not found. Ingest it first via POST /api/repos' });
  }

  const activeJob = await getActiveJobByRepoId(repoId);
  if (activeJob) {
    return res.status(409).json({ error: 'Generation already in progress for this repo', jobId: activeJob.id });
  }

  const jobId = uuid();
  await createQueuedDocJob({
    id: jobId,
    repoId,
    provider: provider || 'cerebras',
    totalEndpoints: repoData.routes.length,
    options: {
      codeTargets,
      temperature,
      maxTokens,
    },
  });

  return res.status(202).json({ jobId, status: 'pending' });
}));

docsRouter.post('/resume/:repoId', requireAdminApiKey, docGenerateLimiter, asyncHandler(async (req: Request, res: Response) => {
  const repoId = Array.isArray(req.params.repoId) ? req.params.repoId[0] : req.params.repoId;

  const repoData = await getRepoData(repoId);
  if (!repoData) {
    return res.status(404).json({ error: 'Repo not found' });
  }

  const activeJob = await getActiveJobByRepoId(repoId);
  if (activeJob) {
    return res.status(409).json({ error: 'Generation already in progress', jobId: activeJob.id });
  }

  const latestJob = await getLatestJobByRepoId(repoId);
  if (!latestJob) {
    return res.status(404).json({ error: 'No previous generation job found' });
  }

  if (latestJob.status !== 'failed') {
    return res.status(400).json({ error: `Cannot resume job with status: ${latestJob.status}` });
  }

  await requeueDocJob(latestJob.id, repoData.routes.length, latestJob.progress);
  return res.status(202).json({ jobId: latestJob.id, status: 'pending' });
}));

docsRouter.get('/jobs/repo/:repoId/latest', requireAdminApiKey, asyncHandler(async (req: Request, res: Response) => {
  const repoId = Array.isArray(req.params.repoId) ? req.params.repoId[0] : req.params.repoId;
  const job = await getLatestJobByRepoId(repoId);

  if (!job) {
    return res.status(404).json({ error: 'No generation job found for this repo' });
  }

  return res.json(serializeJob(job));
}));

docsRouter.get('/jobs/:jobId', requireAdminApiKey, asyncHandler(async (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = await getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Generation job not found' });
  }

  return res.json(serializeJob(job));
}));

docsRouter.get('/jobs/:jobId/events', requireAdminApiKey, asyncHandler(async (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  let lastCursor = '';

  while (!closed) {
    const job = await getJob(jobId);
    if (!job) {
      sendEvent(res, {
        step: 'error',
        progress: 0,
        message: 'Generation job not found',
      });
      break;
    }

    const event = buildProgressFromJob(job);
    const cursor = `${job.updatedAt}:${job.status}:${JSON.stringify(event)}`;

    if (cursor !== lastCursor) {
      sendEvent(res, event);
      lastCursor = cursor;
    }

    if (job.status === 'completed' || job.status === 'failed') {
      break;
    }

    await sleep(1000);
  }

  res.end();
}));

docsRouter.get('/openapi/:repoId', requireAdminApiKey, asyncHandler(async (req: Request, res: Response) => {
  const repoId = Array.isArray(req.params.repoId) ? req.params.repoId[0] : req.params.repoId;
  const spec = await getOpenApiSpec(repoId);
  if (!spec) {
    return res.status(404).json({ error: 'OpenAPI spec not found. Generate docs first.' });
  }

  res.json(spec);
}));
