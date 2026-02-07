import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { reposRouter } from './routes/repos.js';
import { docsRouter } from './routes/docs.js';
import { providersRouter } from './routes/providers.js';
import { logger } from './utils/logger.js';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();

app.use(cors());
app.use(express.json());

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

app.listen(config.port, () => {
  logger.info(`autodocs backend running on port ${config.port}`);
});
