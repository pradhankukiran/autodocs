import { Router, Request, Response } from 'express';
import { ingestRepo, IngestResult } from '../services/repo-ingester.js';
import { parseRoutes, ParsedRoute } from '../services/route-parser.js';
import { logger } from '../utils/logger.js';

export const reposRouter = Router();

// In-memory store for PoC
const repos = new Map<string, {
  ingest: IngestResult;
  routes: ParsedRoute[];
}>();

// Ingest a repo (clone + parse routes)
reposRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required (GitHub URL or local path)' });
    }

    logger.info({ url }, 'Ingesting repo');
    const ingest = await ingestRepo(url);
    const routes = await parseRoutes(ingest.expressFiles, ingest.repoPath);

    repos.set(ingest.repoId, { ingest, routes });

    res.status(201).json({
      repoId: ingest.repoId,
      name: ingest.name,
      expressFiles: ingest.expressFiles.length,
      routes: routes.map(r => ({
        method: r.method,
        path: r.path,
        params: r.params,
        queryParams: r.queryParams,
        hasBody: r.hasBody,
        fileName: r.fileName,
        lineNumber: r.lineNumber,
        auth: r.auth,
      })),
    });
  } catch (err: any) {
    logger.error({ err }, 'Failed to ingest repo');
    res.status(500).json({ error: err.message || 'Failed to ingest repo' });
  }
});

// List ingested repos
reposRouter.get('/', (_req: Request, res: Response) => {
  const list = Array.from(repos.entries()).map(([id, data]) => ({
    repoId: id,
    name: data.ingest.name,
    routeCount: data.routes.length,
    expressFiles: data.ingest.expressFiles.length,
  }));
  res.json(list);
});

// Get repo details
reposRouter.get('/:id', (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const data = repos.get(id);
  if (!data) {
    return res.status(404).json({ error: 'Repo not found' });
  }
  res.json({
    repoId: id,
    name: data.ingest.name,
    repoPath: data.ingest.repoPath,
    expressFiles: data.ingest.expressFiles,
    routes: data.routes.map(r => ({
      method: r.method,
      path: r.path,
      params: r.params,
      queryParams: r.queryParams,
      hasBody: r.hasBody,
      middlewares: r.middlewares,
      fileName: r.fileName,
      lineNumber: r.lineNumber,
      handlerCode: r.handlerCode,
      auth: r.auth,
    })),
  });
});

// Export for doc generation access
export function getRepoData(repoId: string) {
  return repos.get(repoId);
}
