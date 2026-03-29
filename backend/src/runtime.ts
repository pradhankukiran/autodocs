import http from 'http';
import { app } from './app.js';
import { config } from './config.js';
import { closeStorage, getStorageMode, initializeStorage } from './services/db.js';
import { startDocJobRunner, stopDocJobRunner } from './services/doc-job-runner.js';
import { logger } from './utils/logger.js';

let httpServer: http.Server | null = null;

function registerShutdownHandlers(): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');

    stopDocJobRunner();

    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer!.close(() => resolve());
      });
      logger.info('HTTP server closed');
    }

    await closeStorage();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

async function listen(): Promise<void> {
  await new Promise<void>((resolve) => {
    httpServer = app.listen(config.port, () => {
      logger.info({ port: config.port, storage: getStorageMode() }, 'autodocs backend running');
      resolve();
    });
  });
}

export async function startCombinedRuntime(): Promise<void> {
  registerShutdownHandlers();
  await initializeStorage();
  await startDocJobRunner();
  await listen();
}

export async function startServerRuntime(): Promise<void> {
  registerShutdownHandlers();
  await initializeStorage();
  await listen();
}

export async function startWorkerRuntime(): Promise<void> {
  registerShutdownHandlers();
  await initializeStorage();
  await startDocJobRunner();
  logger.info(
    { storage: getStorageMode(), pollIntervalMs: config.docJobPollIntervalMs },
    'autodocs doc worker running',
  );
}
