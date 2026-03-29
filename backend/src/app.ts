import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { reposRouter } from './routes/repos.js';
import { docsRouter } from './routes/docs.js';
import { providersRouter } from './routes/providers.js';
import { globalLimiter } from './middleware/rate-limit.js';
import { checkStorageHealth, getStorageMode } from './services/db.js';
import { AppError } from './errors.js';
import { logger } from './utils/logger.js';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (config.corsOrigins.length === 0 || config.corsOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS blocked for origin: ${origin}`));
  },
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(globalLimiter);

// API routes
app.use('/api/repos', reposRouter);
app.use('/api/docs', docsRouter);
app.use('/api/providers', providersRouter);

// Serve playground
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/playground', express.static(path.resolve(__dirname, '../../playground')));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/ready', async (_req, res) => {
  const storage = await checkStorageHealth();
  const status = storage.ok ? 200 : 503;

  res.status(status).json({
    status: storage.ok ? 'ready' : 'degraded',
    storage: {
      mode: getStorageMode(),
      ok: storage.ok,
      detail: storage.detail,
    },
  });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  res.status(statusCode).json({
    error: err.message || 'Internal server error',
  });
});

export { app };
