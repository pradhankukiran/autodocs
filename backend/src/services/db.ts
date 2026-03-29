import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

const DEFAULT_SETTINGS: Record<string, any> = {
  defaultRenderer: 'rapidoc',
  codeLanguages: ['javascript-fetch', 'python-requests', 'curl'],
  httpClient: 'fetch',
  authDisplay: 'bearer',
  'llm.temperature': 0.3,
  'llm.maxTokens': 4096,
  'llm.fallbackOrder': ['cerebras', 'groq', 'openrouter'],
  interEndpointDelay: 500,
};

let sqliteDb: Database.Database | null = null;
let postgresPool: pg.Pool | null = null;
let postgresInitPromise: Promise<void> | null = null;

function usePostgres(): boolean {
  return Boolean(config.appDatabaseUrl || config.databaseUrl);
}

export function getStorageMode(): 'sqlite' | 'postgres' {
  return usePostgres() ? 'postgres' : 'sqlite';
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  return value as T;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value ?? '');
}

function serializeSettingForSqlite(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

const ALLOWED_TABLE_NAMES = new Set(['repos', 'routes', 'openapi_specs', 'settings', 'generation_jobs']);
const ALLOWED_COLUMN_NAMES = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const ALLOWED_DEFINITIONS = /^[A-Z ]+(?:\s+DEFAULT\s+(?:'[^']*'|\d+|NULL))?$/i;

function ensureSqliteColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string,
) {
  if (!ALLOWED_TABLE_NAMES.has(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  if (!ALLOWED_COLUMN_NAMES.test(columnName)) {
    throw new Error(`Invalid column name: ${columnName}`);
  }
  if (!ALLOWED_DEFINITIONS.test(definition)) {
    throw new Error(`Invalid column definition: ${definition}`);
  }

  const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${definition}`);
}

function getSqliteDb(): Database.Database {
  if (!sqliteDb) {
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    sqliteDb = new Database(config.dbPath);
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('foreign_keys = ON');
    initSqliteSchema(sqliteDb);
    seedSqliteDefaults(sqliteDb);
    logger.info({ path: config.dbPath }, 'SQLite database initialized');
  }

  return sqliteDb;
}

function initSqliteSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      repoId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repoPath TEXT NOT NULL,
      routeFiles TEXT NOT NULL DEFAULT '[]',
      detectedFramework TEXT NOT NULL DEFAULT 'express',
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repoId TEXT NOT NULL REFERENCES repos(repoId) ON DELETE CASCADE,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      handlerCode TEXT NOT NULL,
      middlewares TEXT NOT NULL DEFAULT '[]',
      fileName TEXT NOT NULL,
      lineNumber INTEGER NOT NULL,
      params TEXT NOT NULL DEFAULT '[]',
      queryParams TEXT NOT NULL DEFAULT '[]',
      hasBody INTEGER NOT NULL DEFAULT 0,
      authType TEXT NOT NULL DEFAULT 'none',
      authMiddleware TEXT,
      authHeaderName TEXT
    );

    CREATE TABLE IF NOT EXISTS openapi_specs (
      repoId TEXT PRIMARY KEY REFERENCES repos(repoId) ON DELETE CASCADE,
      spec TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY,
      repoId TEXT NOT NULL REFERENCES repos(repoId) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
      provider TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      totalEndpoints INTEGER NOT NULL DEFAULT 0,
      options TEXT NOT NULL DEFAULT '{}',
      completedEndpoints TEXT NOT NULL DEFAULT '[]',
      failedEndpoints TEXT NOT NULL DEFAULT '[]',
      generatedDocs TEXT NOT NULL DEFAULT '{}',
      lastEvent TEXT,
      openapiSpec TEXT,
      errorMessage TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  ensureSqliteColumn(db, 'generation_jobs', 'options', "TEXT NOT NULL DEFAULT '{}'");
  ensureSqliteColumn(db, 'generation_jobs', 'lastEvent', 'TEXT');
}

function seedSqliteDefaults(db: Database.Database) {
  const count = db.prepare('SELECT COUNT(*) as c FROM settings').get() as { c: number };
  if (count.c > 0) {
    return;
  }

  const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insert.run(key, serializeSettingForSqlite(value));
    }
  });
  tx();
  logger.info('Seeded default settings in SQLite');
}

function getPostgresPool(): pg.Pool {
  if (!postgresPool) {
    const connectionString = config.appDatabaseUrl || config.databaseUrl;
    if (!connectionString) {
      throw new Error('APP_DATABASE_URL or DATABASE_URL is required for Postgres mode.');
    }

    postgresPool = new Pool({
      connectionString,
      ssl: config.appDatabaseSsl ? { rejectUnauthorized: false } : undefined,
    });

    logger.info('Postgres pool initialized');
  }

  return postgresPool;
}

async function ensurePostgresSchemaReady(pool: pg.Pool): Promise<void> {
  const result = await pool.query(`
    SELECT
      to_regclass('public.repos') AS repos,
      to_regclass('public.routes') AS routes,
      to_regclass('public.openapi_specs') AS openapi_specs,
      to_regclass('public.settings') AS settings,
      to_regclass('public.generation_jobs') AS generation_jobs
  `);
  const row = result.rows[0] || {};
  const missing = Object.entries(row)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Postgres schema is not initialized. Missing tables: ${missing.join(', ')}. Run npm run db:migrate:app.`,
    );
  }
}

async function seedPostgresDefaults(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await client.query(
        `
          INSERT INTO settings (key, value)
          VALUES ($1, $2::jsonb)
          ON CONFLICT (key) DO NOTHING
        `,
        [key, serializeJson(value)],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensurePostgresInitialized(): Promise<pg.Pool> {
  const pool = getPostgresPool();

  if (!postgresInitPromise) {
    postgresInitPromise = (async () => {
      await ensurePostgresSchemaReady(pool);
      await seedPostgresDefaults(pool);
    })().catch((error) => {
      postgresInitPromise = null;
      throw error;
    });
  }

  await postgresInitPromise;
  return pool;
}

export async function initializeStorage(): Promise<void> {
  if (usePostgres()) {
    await ensurePostgresInitialized();
    return;
  }

  getSqliteDb();
}

export async function closeStorage(): Promise<void> {
  if (postgresPool) {
    await postgresPool.end();
    postgresPool = null;
    postgresInitPromise = null;
    logger.info('Postgres pool closed');
  }
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
    logger.info('SQLite database closed');
  }
}

export async function checkStorageHealth(): Promise<{
  ok: boolean;
  mode: 'sqlite' | 'postgres';
  detail?: string;
}> {
  const mode = getStorageMode();

  try {
    if (mode === 'postgres') {
      const pool = await ensurePostgresInitialized();
      await pool.query('SELECT 1');
    } else {
      const db = getSqliteDb();
      db.prepare('SELECT 1').get();
    }

    return { ok: true, mode };
  } catch (error) {
    return {
      ok: false,
      mode,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface RepoRow {
  repoId: string;
  name: string;
  repoPath: string;
  routeFiles: string[];
  detectedFramework: string;
  createdAt: string;
}

export interface RouteRow {
  id: number;
  repoId: string;
  method: string;
  path: string;
  handlerCode: string;
  middlewares: string[];
  fileName: string;
  lineNumber: number;
  params: string[];
  queryParams: string[];
  hasBody: boolean;
  authType: string;
  authMiddleware: string | null;
  authHeaderName: string | null;
}

export interface GenerationJobRow {
  id: string;
  repoId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  provider: string;
  progress: number;
  totalEndpoints: number;
  options: GenerationJobOptions;
  completedEndpoints: string[];
  failedEndpoints: Array<{ endpoint: string; error: string; provider?: string }>;
  generatedDocs: Record<string, string>;
  lastEvent: JobProgressEvent | null;
  openapiSpec: object | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationJobOptions {
  codeTargets?: string[];
  temperature?: number;
  maxTokens?: number;
  interEndpointDelay?: number;
}

export interface JobProgressEvent {
  step: 'queued' | 'parsing' | 'generating' | 'publishing' | 'complete' | 'error';
  progress: number;
  message: string;
  current?: number;
  total?: number;
  endpoint?: string;
  wikiUrl?: string;
  pagesCreated?: number;
  failedEndpoints?: Array<{ endpoint: string; error: string }>;
}

type RepoInsert = {
  repoId: string;
  name: string;
  repoPath: string;
  routeFiles: string[];
  detectedFramework: string;
};

type RouteInsert = {
  method: string;
  path: string;
  handlerCode: string;
  middlewares: string[];
  fileName: string;
  lineNumber: number;
  params: string[];
  queryParams: string[];
  hasBody: boolean;
  authType: string;
  authMiddleware?: string;
  authHeaderName?: string;
};

function parseRepoRow(row: any): RepoRow {
  return {
    repoId: row.repoId,
    name: row.name,
    repoPath: row.repoPath,
    routeFiles: parseJsonField<string[]>(row.routeFiles, []),
    detectedFramework: row.detectedFramework,
    createdAt: normalizeTimestamp(row.createdAt),
  };
}

function parseRouteRow(row: any): RouteRow {
  return {
    id: Number(row.id),
    repoId: row.repoId,
    method: row.method,
    path: row.path,
    handlerCode: row.handlerCode,
    middlewares: parseJsonField<string[]>(row.middlewares, []),
    fileName: row.fileName,
    lineNumber: Number(row.lineNumber),
    params: parseJsonField<string[]>(row.params, []),
    queryParams: parseJsonField<string[]>(row.queryParams, []),
    hasBody: row.hasBody === true || row.hasBody === 1,
    authType: row.authType,
    authMiddleware: row.authMiddleware ?? null,
    authHeaderName: row.authHeaderName ?? null,
  };
}

function parseJobRow(row: any): GenerationJobRow {
  return {
    id: row.id,
    repoId: row.repoId,
    status: row.status,
    provider: row.provider,
    progress: Number(row.progress),
    totalEndpoints: Number(row.totalEndpoints),
    options: parseJsonField<GenerationJobOptions>(row.options, {}),
    completedEndpoints: parseJsonField<string[]>(row.completedEndpoints, []),
    failedEndpoints: parseJsonField<Array<{ endpoint: string; error: string; provider?: string }>>(row.failedEndpoints, []),
    generatedDocs: parseJsonField<Record<string, string>>(row.generatedDocs, {}),
    lastEvent: parseJsonField<JobProgressEvent | null>(row.lastEvent, null),
    openapiSpec: parseJsonField<object | null>(row.openapiSpec, null),
    errorMessage: row.errorMessage ?? null,
    createdAt: normalizeTimestamp(row.createdAt),
    updatedAt: normalizeTimestamp(row.updatedAt),
  };
}

export async function insertRepo(repo: RepoInsert, routes: RouteInsert[]): Promise<void> {
  if (!usePostgres()) {
    const db = getSqliteDb();
    const insertRepoStmt = db.prepare(
      'INSERT INTO repos (repoId, name, repoPath, routeFiles, detectedFramework) VALUES (?, ?, ?, ?, ?)',
    );
    const insertRouteStmt = db.prepare(
      `INSERT INTO routes (repoId, method, path, handlerCode, middlewares, fileName, lineNumber, params, queryParams, hasBody, authType, authMiddleware, authHeaderName)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const tx = db.transaction(() => {
      insertRepoStmt.run(
        repo.repoId,
        repo.name,
        repo.repoPath,
        serializeJson(repo.routeFiles),
        repo.detectedFramework,
      );

      for (const route of routes) {
        insertRouteStmt.run(
          repo.repoId,
          route.method,
          route.path,
          route.handlerCode,
          serializeJson(route.middlewares),
          route.fileName,
          route.lineNumber,
          serializeJson(route.params),
          serializeJson(route.queryParams),
          route.hasBody ? 1 : 0,
          route.authType,
          route.authMiddleware || null,
          route.authHeaderName || null,
        );
      }
    });

    tx();
    return;
  }

  const pool = await ensurePostgresInitialized();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `
        INSERT INTO repos (repo_id, name, repo_path, route_files, detected_framework)
        VALUES ($1, $2, $3, $4::jsonb, $5)
      `,
      [
        repo.repoId,
        repo.name,
        repo.repoPath,
        serializeJson(repo.routeFiles),
        repo.detectedFramework,
      ],
    );

    for (const route of routes) {
      await client.query(
        `
          INSERT INTO routes (
            repo_id,
            method,
            path,
            handler_code,
            middlewares,
            file_name,
            line_number,
            params,
            query_params,
            has_body,
            auth_type,
            auth_middleware,
            auth_header_name
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13)
        `,
        [
          repo.repoId,
          route.method,
          route.path,
          route.handlerCode,
          serializeJson(route.middlewares),
          route.fileName,
          route.lineNumber,
          serializeJson(route.params),
          serializeJson(route.queryParams),
          route.hasBody,
          route.authType,
          route.authMiddleware || null,
          route.authHeaderName || null,
        ],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getRepo(repoId: string): Promise<{ repo: RepoRow; routes: RouteRow[] } | null> {
  if (!usePostgres()) {
    const db = getSqliteDb();
    const row = db.prepare('SELECT * FROM repos WHERE repoId = ?').get(repoId);
    if (!row) {
      return null;
    }

    const routes = db.prepare('SELECT * FROM routes WHERE repoId = ? ORDER BY id').all(repoId);
    return {
      repo: parseRepoRow(row),
      routes: routes.map(parseRouteRow),
    };
  }

  const pool = await ensurePostgresInitialized();
  const repoResult = await pool.query(
    `
      SELECT
        repo_id AS "repoId",
        name,
        repo_path AS "repoPath",
        route_files AS "routeFiles",
        detected_framework AS "detectedFramework",
        created_at::text AS "createdAt"
      FROM repos
      WHERE repo_id = $1
    `,
    [repoId],
  );

  if (repoResult.rowCount === 0) {
    return null;
  }

  const routesResult = await pool.query(
    `
      SELECT
        id,
        repo_id AS "repoId",
        method,
        path,
        handler_code AS "handlerCode",
        middlewares,
        file_name AS "fileName",
        line_number AS "lineNumber",
        params,
        query_params AS "queryParams",
        has_body AS "hasBody",
        auth_type AS "authType",
        auth_middleware AS "authMiddleware",
        auth_header_name AS "authHeaderName"
      FROM routes
      WHERE repo_id = $1
      ORDER BY id
    `,
    [repoId],
  );

  return {
    repo: parseRepoRow(repoResult.rows[0]),
    routes: routesResult.rows.map(parseRouteRow),
  };
}

export async function listRepos(): Promise<Array<RepoRow & { routeCount: number }>> {
  if (!usePostgres()) {
    const db = getSqliteDb();
    const rows = db.prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM routes WHERE repoId = r.repoId) as routeCount
       FROM repos r ORDER BY r.createdAt DESC`,
    ).all() as any[];

    return rows.map((row) => ({
      ...parseRepoRow(row),
      routeCount: Number(row.routeCount),
    }));
  }

  const pool = await ensurePostgresInitialized();
  const result = await pool.query(
    `
      SELECT
        r.repo_id AS "repoId",
        r.name,
        r.repo_path AS "repoPath",
        r.route_files AS "routeFiles",
        r.detected_framework AS "detectedFramework",
        r.created_at::text AS "createdAt",
        COUNT(rt.id)::int AS "routeCount"
      FROM repos r
      LEFT JOIN routes rt ON rt.repo_id = r.repo_id
      GROUP BY r.repo_id
      ORDER BY r.created_at DESC
    `,
  );

  return result.rows.map((row) => ({
    ...parseRepoRow(row),
    routeCount: Number(row.routeCount),
  }));
}

export async function deleteRepo(repoId: string): Promise<boolean> {
  if (!usePostgres()) {
    const db = getSqliteDb();
    const result = db.prepare('DELETE FROM repos WHERE repoId = ?').run(repoId);
    return result.changes > 0;
  }

  const pool = await ensurePostgresInitialized();
  const result = await pool.query('DELETE FROM repos WHERE repo_id = $1', [repoId]);
  return (result.rowCount ?? 0) > 0;
}

export async function upsertOpenApiSpec(repoId: string, spec: object): Promise<void> {
  if (!usePostgres()) {
    const db = getSqliteDb();
    db.prepare(
      `INSERT INTO openapi_specs (repoId, spec) VALUES (?, ?)
       ON CONFLICT(repoId) DO UPDATE SET spec = excluded.spec, createdAt = datetime('now')`,
    ).run(repoId, serializeJson(spec));
    return;
  }

  const pool = await ensurePostgresInitialized();
  await pool.query(
    `
      INSERT INTO openapi_specs (repo_id, spec)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (repo_id)
      DO UPDATE SET spec = EXCLUDED.spec, created_at = NOW()
    `,
    [repoId, serializeJson(spec)],
  );
}

export async function getOpenApiSpec(repoId: string): Promise<object | null> {
  if (!usePostgres()) {
    const db = getSqliteDb();
    const row = db.prepare('SELECT spec FROM openapi_specs WHERE repoId = ?').get(repoId) as { spec: string } | undefined;
    return row ? parseJsonField<object>(row.spec, {}) : null;
  }

  const pool = await ensurePostgresInitialized();
  const result = await pool.query('SELECT spec FROM openapi_specs WHERE repo_id = $1', [repoId]);
  if (result.rowCount === 0) {
    return null;
  }

  return parseJsonField<object>(result.rows[0].spec, {});
}

export async function getAllSettings(): Promise<Record<string, any>> {
  if (!usePostgres()) {
    const db = getSqliteDb();
    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
    const settings: Record<string, any> = {};

    for (const row of rows) {
      settings[row.key] = parseJsonField(row.value, row.value);
    }

    return settings;
  }

  const pool = await ensurePostgresInitialized();
  const result = await pool.query('SELECT key, value FROM settings');
  const settings: Record<string, any> = {};

  for (const row of result.rows) {
    settings[row.key] = parseJsonField(row.value, row.value);
  }

  return settings;
}

export async function getSetting(key: string): Promise<any> {
  if (!usePostgres()) {
    const db = getSqliteDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) {
      return undefined;
    }

    return parseJsonField(row.value, row.value);
  }

  const pool = await ensurePostgresInitialized();
  const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  if (result.rowCount === 0) {
    return undefined;
  }

  return parseJsonField(result.rows[0].value, result.rows[0].value);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  if (!usePostgres()) {
    const db = getSqliteDb();
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, serializeSettingForSqlite(value));
    return;
  }

  const pool = await ensurePostgresInitialized();
  await pool.query(
    `
      INSERT INTO settings (key, value)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value
    `,
    [key, serializeJson(value)],
  );
}

export async function createJob(job: {
  id: string;
  repoId: string;
  provider: string;
  totalEndpoints: number;
  options?: GenerationJobOptions;
}): Promise<void> {
  const queuedEvent: JobProgressEvent = {
    step: 'queued',
    progress: 0,
    message: 'Queued for generation',
    total: job.totalEndpoints,
  };

  if (!usePostgres()) {
    const db = getSqliteDb();
    db.prepare(
      `INSERT INTO generation_jobs (id, repoId, status, provider, progress, totalEndpoints, options, lastEvent)
       VALUES (?, ?, 'pending', ?, 0, ?, ?, ?)`,
    ).run(
      job.id,
      job.repoId,
      job.provider,
      job.totalEndpoints,
      serializeJson(job.options || {}),
      serializeJson(queuedEvent),
    );
    return;
  }

  const pool = await ensurePostgresInitialized();
  await pool.query(
    `
      INSERT INTO generation_jobs (id, repo_id, status, provider, progress, total_endpoints, options, last_event)
      VALUES ($1, $2, 'pending', $3, 0, $4, $5::jsonb, $6::jsonb)
    `,
    [
      job.id,
      job.repoId,
      job.provider,
      job.totalEndpoints,
      serializeJson(job.options || {}),
      serializeJson(queuedEvent),
    ],
  );
}

export async function getJob(jobId: string): Promise<GenerationJobRow | null> {
  if (!usePostgres()) {
    const db = getSqliteDb();
    const row = db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(jobId);
    return row ? parseJobRow(row) : null;
  }

  const pool = await ensurePostgresInitialized();
  const result = await pool.query(
    `
      SELECT
        id,
        repo_id AS "repoId",
        status,
        provider,
        progress,
        total_endpoints AS "totalEndpoints",
        options,
        completed_endpoints AS "completedEndpoints",
        failed_endpoints AS "failedEndpoints",
        generated_docs AS "generatedDocs",
        last_event AS "lastEvent",
        openapi_spec AS "openapiSpec",
        error_message AS "errorMessage",
        created_at::text AS "createdAt",
        updated_at::text AS "updatedAt"
      FROM generation_jobs
      WHERE id = $1
    `,
    [jobId],
  );

  return result.rowCount === 0 ? null : parseJobRow(result.rows[0]);
}

export async function getLatestJobByRepoId(repoId: string): Promise<GenerationJobRow | null> {
  if (!usePostgres()) {
    const db = getSqliteDb();
    const row = db.prepare(
      'SELECT * FROM generation_jobs WHERE repoId = ? ORDER BY createdAt DESC LIMIT 1',
    ).get(repoId);
    return row ? parseJobRow(row) : null;
  }

  const pool = await ensurePostgresInitialized();
  const result = await pool.query(
    `
      SELECT
        id,
        repo_id AS "repoId",
        status,
        provider,
        progress,
        total_endpoints AS "totalEndpoints",
        options,
        completed_endpoints AS "completedEndpoints",
        failed_endpoints AS "failedEndpoints",
        generated_docs AS "generatedDocs",
        last_event AS "lastEvent",
        openapi_spec AS "openapiSpec",
        error_message AS "errorMessage",
        created_at::text AS "createdAt",
        updated_at::text AS "updatedAt"
      FROM generation_jobs
      WHERE repo_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [repoId],
  );

  return result.rowCount === 0 ? null : parseJobRow(result.rows[0]);
}

export async function getRunningJobByRepoId(repoId: string): Promise<GenerationJobRow | null> {
  if (!usePostgres()) {
    const db = getSqliteDb();
    const row = db.prepare(
      "SELECT * FROM generation_jobs WHERE repoId = ? AND status = 'running' LIMIT 1",
    ).get(repoId);
    return row ? parseJobRow(row) : null;
  }

  const pool = await ensurePostgresInitialized();
  const result = await pool.query(
    `
      SELECT
        id,
        repo_id AS "repoId",
        status,
        provider,
        progress,
        total_endpoints AS "totalEndpoints",
        options,
        completed_endpoints AS "completedEndpoints",
        failed_endpoints AS "failedEndpoints",
        generated_docs AS "generatedDocs",
        last_event AS "lastEvent",
        openapi_spec AS "openapiSpec",
        error_message AS "errorMessage",
        created_at::text AS "createdAt",
        updated_at::text AS "updatedAt"
      FROM generation_jobs
      WHERE repo_id = $1 AND status = 'running'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [repoId],
  );

  return result.rowCount === 0 ? null : parseJobRow(result.rows[0]);
}

export async function getActiveJobByRepoId(repoId: string): Promise<GenerationJobRow | null> {
  if (!usePostgres()) {
    const db = getSqliteDb();
    const row = db.prepare(
      "SELECT * FROM generation_jobs WHERE repoId = ? AND status IN ('pending', 'running') ORDER BY createdAt DESC LIMIT 1",
    ).get(repoId);
    return row ? parseJobRow(row) : null;
  }

  const pool = await ensurePostgresInitialized();
  const result = await pool.query(
    `
      SELECT
        id,
        repo_id AS "repoId",
        status,
        provider,
        progress,
        total_endpoints AS "totalEndpoints",
        options,
        completed_endpoints AS "completedEndpoints",
        failed_endpoints AS "failedEndpoints",
        generated_docs AS "generatedDocs",
        last_event AS "lastEvent",
        openapi_spec AS "openapiSpec",
        error_message AS "errorMessage",
        created_at::text AS "createdAt",
        updated_at::text AS "updatedAt"
      FROM generation_jobs
      WHERE repo_id = $1 AND status IN ('pending', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [repoId],
  );

  return result.rowCount === 0 ? null : parseJobRow(result.rows[0]);
}

export async function listJobsByStatuses(
  statuses: Array<GenerationJobRow['status']>,
): Promise<GenerationJobRow[]> {
  if (statuses.length === 0) {
    return [];
  }

  if (!usePostgres()) {
    const db = getSqliteDb();
    const placeholders = statuses.map(() => '?').join(', ');
    const rows = db.prepare(
      `SELECT * FROM generation_jobs WHERE status IN (${placeholders}) ORDER BY createdAt ASC`,
    ).all(...statuses) as any[];
    return rows.map(parseJobRow);
  }

  const pool = await ensurePostgresInitialized();
  const result = await pool.query(
    `
      SELECT
        id,
        repo_id AS "repoId",
        status,
        provider,
        progress,
        total_endpoints AS "totalEndpoints",
        options,
        completed_endpoints AS "completedEndpoints",
        failed_endpoints AS "failedEndpoints",
        generated_docs AS "generatedDocs",
        last_event AS "lastEvent",
        openapi_spec AS "openapiSpec",
        error_message AS "errorMessage",
        created_at::text AS "createdAt",
        updated_at::text AS "updatedAt"
      FROM generation_jobs
      WHERE status = ANY($1::text[])
      ORDER BY created_at ASC
    `,
    [statuses],
  );

  return result.rows.map(parseJobRow);
}

export async function getNextPendingJob(): Promise<GenerationJobRow | null> {
  if (!usePostgres()) {
    const db = getSqliteDb();
    const row = db.prepare(
      "SELECT * FROM generation_jobs WHERE status = 'pending' ORDER BY createdAt ASC LIMIT 1",
    ).get();
    return row ? parseJobRow(row) : null;
  }

  const pool = await ensurePostgresInitialized();
  const result = await pool.query(
    `
      SELECT
        id,
        repo_id AS "repoId",
        status,
        provider,
        progress,
        total_endpoints AS "totalEndpoints",
        options,
        completed_endpoints AS "completedEndpoints",
        failed_endpoints AS "failedEndpoints",
        generated_docs AS "generatedDocs",
        last_event AS "lastEvent",
        openapi_spec AS "openapiSpec",
        error_message AS "errorMessage",
        created_at::text AS "createdAt",
        updated_at::text AS "updatedAt"
      FROM generation_jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `,
  );

  return result.rowCount === 0 ? null : parseJobRow(result.rows[0]);
}

export async function setJobPending(jobId: string, event?: JobProgressEvent): Promise<void> {
  const nextEvent = event || {
    step: 'queued',
    progress: 0,
    message: 'Queued for generation',
  };

  if (!usePostgres()) {
    const db = getSqliteDb();
    db.prepare(
      `UPDATE generation_jobs
       SET status = 'pending', progress = ?, lastEvent = ?, errorMessage = NULL, updatedAt = datetime('now')
       WHERE id = ?`,
    ).run(nextEvent.progress, serializeJson(nextEvent), jobId);
    return;
  }

  const pool = await ensurePostgresInitialized();
  await pool.query(
    `
      UPDATE generation_jobs
      SET status = 'pending',
          progress = $1,
          last_event = $2::jsonb,
          error_message = NULL,
          updated_at = NOW()
      WHERE id = $3
    `,
    [nextEvent.progress, serializeJson(nextEvent), jobId],
  );
}

export async function setJobProgress(jobId: string, event: JobProgressEvent): Promise<void> {
  if (!usePostgres()) {
    const db = getSqliteDb();
    db.prepare(
      `UPDATE generation_jobs
       SET status = 'running', progress = ?, lastEvent = ?, updatedAt = datetime('now')
       WHERE id = ?`,
    ).run(event.progress, serializeJson(event), jobId);
    return;
  }

  const pool = await ensurePostgresInitialized();
  await pool.query(
    `
      UPDATE generation_jobs
      SET status = 'running',
          progress = $1,
          last_event = $2::jsonb,
          updated_at = NOW()
      WHERE id = $3
    `,
    [event.progress, serializeJson(event), jobId],
  );
}

export async function markEndpointComplete(
  jobId: string,
  endpoint: string,
  resource: string,
  markdown: string,
): Promise<void> {
  const job = await getJob(jobId);
  if (!job) {
    return;
  }

  const completed = [...job.completedEndpoints, endpoint];
  const generatedDocs = {
    ...job.generatedDocs,
    [resource]: (job.generatedDocs[resource] || '') + markdown,
  };
  const failedEndpoints = job.failedEndpoints.filter((item) => item.endpoint !== endpoint);
  const progress = Math.round((completed.length / Math.max(job.totalEndpoints, 1)) * 100);

  if (!usePostgres()) {
    const db = getSqliteDb();
    db.prepare(
      `UPDATE generation_jobs
       SET completedEndpoints = ?, failedEndpoints = ?, generatedDocs = ?, progress = ?, updatedAt = datetime('now')
       WHERE id = ?`,
    ).run(serializeJson(completed), serializeJson(failedEndpoints), serializeJson(generatedDocs), progress, jobId);
    return;
  }

  const pool = await ensurePostgresInitialized();
  await pool.query(
    `
      UPDATE generation_jobs
      SET completed_endpoints = $1::jsonb,
          failed_endpoints = $2::jsonb,
          generated_docs = $3::jsonb,
          progress = $4,
          updated_at = NOW()
      WHERE id = $5
    `,
    [serializeJson(completed), serializeJson(failedEndpoints), serializeJson(generatedDocs), progress, jobId],
  );
}

export async function markEndpointFailed(
  jobId: string,
  endpoint: string,
  error: string,
  provider?: string,
): Promise<void> {
  const job = await getJob(jobId);
  if (!job) {
    return;
  }

  const failed = [...job.failedEndpoints, { endpoint, error, provider }];

  if (!usePostgres()) {
    const db = getSqliteDb();
    db.prepare(
      `UPDATE generation_jobs
       SET failedEndpoints = ?, updatedAt = datetime('now')
       WHERE id = ?`,
    ).run(serializeJson(failed), jobId);
    return;
  }

  const pool = await ensurePostgresInitialized();
  await pool.query(
    `
      UPDATE generation_jobs
      SET failed_endpoints = $1::jsonb,
          updated_at = NOW()
      WHERE id = $2
    `,
    [serializeJson(failed), jobId],
  );
}

export async function completeJob(jobId: string, openapiSpec?: object, event?: JobProgressEvent): Promise<void> {
  const lastEvent = event || {
    step: 'complete',
    progress: 100,
    message: 'Documentation generated successfully!',
  };

  if (!usePostgres()) {
    const db = getSqliteDb();
    db.prepare(
      `UPDATE generation_jobs
       SET status = 'completed', progress = ?, lastEvent = ?, openapiSpec = ?, updatedAt = datetime('now')
       WHERE id = ?`,
    ).run(lastEvent.progress, serializeJson(lastEvent), openapiSpec ? serializeJson(openapiSpec) : null, jobId);
    return;
  }

  const pool = await ensurePostgresInitialized();
  await pool.query(
    `
      UPDATE generation_jobs
      SET status = 'completed',
          progress = $1,
          last_event = $2::jsonb,
          openapi_spec = $3::jsonb,
          updated_at = NOW()
      WHERE id = $4
    `,
    [lastEvent.progress, serializeJson(lastEvent), openapiSpec ? serializeJson(openapiSpec) : null, jobId],
  );
}

export async function failJob(jobId: string, errorMessage: string, event?: JobProgressEvent): Promise<void> {
  const lastEvent = event || {
    step: 'error',
    progress: 0,
    message: errorMessage,
  };

  if (!usePostgres()) {
    const db = getSqliteDb();
    db.prepare(
      `UPDATE generation_jobs
       SET status = 'failed', progress = ?, lastEvent = ?, errorMessage = ?, updatedAt = datetime('now')
       WHERE id = ?`,
    ).run(lastEvent.progress, serializeJson(lastEvent), errorMessage, jobId);
    return;
  }

  const pool = await ensurePostgresInitialized();
  await pool.query(
    `
      UPDATE generation_jobs
      SET status = 'failed',
          progress = $1,
          last_event = $2::jsonb,
          error_message = $3,
          updated_at = NOW()
      WHERE id = $4
    `,
    [lastEvent.progress, serializeJson(lastEvent), errorMessage, jobId],
  );
}
