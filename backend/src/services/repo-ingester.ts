import { simpleGit } from 'simple-git';
import fg from 'fast-glob';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface IngestResult {
  repoId: string;
  repoPath: string;
  name: string;
  expressFiles: string[];
}

function isGitUrl(input: string): boolean {
  return input.startsWith('http://') || input.startsWith('https://') || input.startsWith('git@');
}

function extractName(input: string): string {
  if (isGitUrl(input)) {
    const parts = input.replace(/\.git$/, '').split('/');
    return parts[parts.length - 1] || 'unknown';
  }
  return path.basename(input);
}

export async function ingestRepo(input: string): Promise<IngestResult> {
  const repoId = uuid();
  const reposDir = config.reposDir;
  await fs.mkdir(reposDir, { recursive: true });

  let repoPath: string;

  if (isGitUrl(input)) {
    repoPath = path.join(reposDir, repoId);
    logger.info({ input, repoPath }, 'Cloning repository');
    const git = simpleGit();
    await git.clone(input, repoPath, ['--depth', '1']);
  } else {
    // Local path — validate it exists
    const stats = await fs.stat(input);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${input}`);
    }
    repoPath = input;
    logger.info({ input }, 'Using local path');
  }

  // Find files that reference Express
  const allFiles = await fg(['**/*.{ts,js,mjs}'], {
    cwd: repoPath,
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**'],
    absolute: true,
  });

  const expressFiles: string[] = [];
  for (const file of allFiles) {
    const content = await fs.readFile(file, 'utf-8');
    if (
      content.includes("from 'express'") ||
      content.includes('from "express"') ||
      content.includes("require('express')") ||
      content.includes('require("express")')
    ) {
      expressFiles.push(file);
    }
  }

  logger.info({ count: expressFiles.length }, 'Found Express files');

  return {
    repoId,
    repoPath,
    name: extractName(input),
    expressFiles,
  };
}
