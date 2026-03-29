import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

let warnedNoKey = false;

function extractApiKey(req: Request): string {
  const headerKey = req.header('x-admin-api-key');
  if (headerKey) return headerKey;

  const authHeader = req.header('authorization');
  if (!authHeader) return '';

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export function requireAdminApiKey(req: Request, res: Response, next: NextFunction) {
  if (!config.adminApiKey) {
    if (!warnedNoKey) {
      logger.warn('ADMIN_API_KEY is not set — all admin endpoints are unprotected. Set ADMIN_API_KEY in production.');
      warnedNoKey = true;
    }
    return next();
  }

  const apiKey = extractApiKey(req);
  if (apiKey && apiKey === config.adminApiKey) {
    return next();
  }

  res.status(401).json({
    error: 'Unauthorized',
    message: 'A valid admin API key is required for this endpoint.',
  });
}
