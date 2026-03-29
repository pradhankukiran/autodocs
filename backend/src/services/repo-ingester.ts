import { simpleGit } from 'simple-git';
import fg from 'fast-glob';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { logger } from '../utils/logger.js';
import type { FrameworkType } from './parsers/index.js';

export interface IngestResult {
  repoId: string;
  repoPath: string;
  name: string;
  routeFiles: string[];
  detectedFramework: FrameworkType;
}

const FRAMEWORK_PATTERNS: Array<{ framework: FrameworkType; patterns: string[] }> = [
  {
    framework: 'express',
    patterns: [
      "from 'express'", 'from "express"',
      "require('express')", 'require("express")',
    ],
  },
  {
    framework: 'fastify',
    patterns: [
      "from 'fastify'", 'from "fastify"',
      "require('fastify')", 'require("fastify")',
    ],
  },
  {
    framework: 'koa',
    patterns: [
      "'koa-router'", '"koa-router"',
      "'@koa/router'", '"@koa/router"',
    ],
  },
];

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
    if (!config.allowLocalRepoPaths) {
      throw new AppError(
        'Local filesystem repo ingestion is disabled. Set ALLOW_LOCAL_REPO_PATHS=true to enable it.',
        403
      );
    }

    const stats = await fs.stat(input);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${input}`);
    }
    repoPath = input;
    logger.info({ input }, 'Using local path');
  }

  const allFiles = await fg(['**/*.{ts,js,mjs}'], {
    cwd: repoPath,
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**'],
    absolute: true,
  });

  const routeFiles: string[] = [];
  let detectedFramework: FrameworkType = 'unknown';
  const frameworkCounts = new Map<FrameworkType, number>();

  for (const file of allFiles) {
    const content = await fs.readFile(file, 'utf-8');

    for (const { framework, patterns } of FRAMEWORK_PATTERNS) {
      if (patterns.some((p) => content.includes(p))) {
        routeFiles.push(file);
        frameworkCounts.set(framework, (frameworkCounts.get(framework) || 0) + 1);
        break;
      }
    }
  }

  // Use the most common framework
  let maxCount = 0;
  for (const [fw, count] of frameworkCounts) {
    if (count > maxCount) {
      maxCount = count;
      detectedFramework = fw;
    }
  }

  logger.info({ count: routeFiles.length, framework: detectedFramework }, 'Found route files');

  return {
    repoId,
    repoPath,
    name: extractName(input),
    routeFiles,
    detectedFramework,
  };
}
