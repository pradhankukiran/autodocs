import { Router, Request, Response, NextFunction } from 'express';
import { ingestRepo } from '../services/repo-ingester.js';
import { parseRoutes } from '../services/route-parser.js';
import { insertRepo, getRepo, listRepos } from '../services/db.js';
import { requireAdminApiKey } from '../middleware/admin-auth.js';
import { validateBody, ingestRepoSchema } from '../middleware/validation.js';
import { repoIngestLimiter } from '../middleware/rate-limit.js';
import { AppError } from '../errors.js';
import { logger } from '../utils/logger.js';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;
function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export const reposRouter = Router();
reposRouter.use(requireAdminApiKey);

// Ingest a repo (clone + parse routes)
reposRouter.post('/', repoIngestLimiter, validateBody(ingestRepoSchema), async (req: Request, res: Response) => {
  try {
    const { url } = req.body;

    logger.info({ url }, 'Ingesting repo');
    const ingest = await ingestRepo(url);
    const routes = await parseRoutes(ingest.routeFiles, ingest.repoPath);

    await insertRepo(
      {
        repoId: ingest.repoId,
        name: ingest.name,
        repoPath: ingest.repoPath,
        routeFiles: ingest.routeFiles,
        detectedFramework: ingest.detectedFramework,
      },
      routes.map((r) => ({
        method: r.method,
        path: r.path,
        handlerCode: r.handlerCode,
        middlewares: r.middlewares,
        fileName: r.fileName,
        lineNumber: r.lineNumber,
        params: r.params,
        queryParams: r.queryParams,
        hasBody: r.hasBody,
        authType: r.auth.type,
        authMiddleware: r.auth.middleware,
        authHeaderName: r.auth.headerName,
      }))
    );

    res.status(201).json({
      repoId: ingest.repoId,
      name: ingest.name,
      routeFiles: ingest.routeFiles.length,
      framework: ingest.detectedFramework,
      routes: routes.map((r) => ({
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
    const statusCode = err instanceof AppError ? err.statusCode : 500;
    res.status(statusCode).json({ error: err.message || 'Failed to ingest repo' });
  }
});

// List ingested repos
reposRouter.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const list = (await listRepos()).map((r) => ({
    repoId: r.repoId,
    name: r.name,
    routeCount: r.routeCount,
    routeFiles: r.routeFiles.length,
    framework: r.detectedFramework,
  }));
  res.json(list);
}));

// Get repo details
reposRouter.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const data = await getRepo(id);
  if (!data) {
    return res.status(404).json({ error: 'Repo not found' });
  }
  res.json({
    repoId: data.repo.repoId,
    name: data.repo.name,
    repoPath: data.repo.repoPath,
    routeFiles: data.repo.routeFiles,
    framework: data.repo.detectedFramework,
    routes: data.routes.map((r) => ({
      method: r.method,
      path: r.path,
      params: r.params,
      queryParams: r.queryParams,
      hasBody: r.hasBody,
      middlewares: r.middlewares,
      fileName: r.fileName,
      lineNumber: r.lineNumber,
      handlerCode: r.handlerCode,
      auth: {
        type: r.authType,
        middleware: r.authMiddleware || undefined,
        headerName: r.authHeaderName || undefined,
      },
    })),
  });
}));
