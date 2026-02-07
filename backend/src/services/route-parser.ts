import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import fs from 'fs/promises';
import { logger } from '../utils/logger.js';

// Handle ESM default import quirks
const traverse = (_traverse as any).default || _traverse;
const generate = (_generate as any).default || _generate;

export interface AuthInfo {
  type: 'bearer' | 'api-key' | 'basic' | 'oauth2' | 'jwt' | 'custom' | 'none';
  middleware?: string;   // name of auth middleware detected
  headerName?: string;   // e.g., 'Authorization', 'X-API-Key'
}

export interface ParsedRoute {
  method: string;
  path: string;
  handlerCode: string;
  middlewares: string[];
  fileName: string;
  lineNumber: number;
  params: string[];
  queryParams: string[];
  hasBody: boolean;
  auth: AuthInfo;
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all']);

export async function parseRoutes(files: string[], basePath: string): Promise<ParsedRoute[]> {
  const allRoutes: ParsedRoute[] = [];
  const routerMountPrefixes = new Map<string, string>(); // variable name -> mount prefix

  // First pass: find app.use('/prefix', router) in all files to build prefix map
  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8');
    const prefixes = findMountPrefixes(content);
    for (const [varName, prefix] of prefixes) {
      routerMountPrefixes.set(varName, prefix);
    }
  }

  // Second pass: extract routes from each file
  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const routes = extractRoutes(content, file, basePath, routerMountPrefixes);
      allRoutes.push(...routes);
    } catch (err) {
      logger.warn({ file, err }, 'Failed to parse file');
    }
  }

  return allRoutes;
}

function findMountPrefixes(code: string): Map<string, string> {
  const prefixes = new Map<string, string>();

  try {
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy', 'dynamicImport', 'classProperties'],
    });

    traverse(ast, {
      CallExpression(path: any) {
        const { node } = path;
        // Look for app.use('/prefix', someRouter)
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.name === 'use' &&
          node.arguments.length >= 2 &&
          node.arguments[0].type === 'StringLiteral'
        ) {
          const prefix = node.arguments[0].value;
          const routerArg = node.arguments[1];
          if (routerArg.type === 'Identifier') {
            prefixes.set(routerArg.name, prefix);
          }
        }
      },
    });
  } catch {
    // Ignore parse errors for prefix scanning
  }

  return prefixes;
}

function extractRoutes(
  code: string,
  fileName: string,
  basePath: string,
  mountPrefixes: Map<string, string>
): ParsedRoute[] {
  const routes: ParsedRoute[] = [];
  const routerVarNames = new Set<string>();

  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx', 'decorators-legacy', 'dynamicImport', 'classProperties'],
  });

  // Find router/app variable names
  traverse(ast, {
    VariableDeclarator(path: any) {
      const { node } = path;
      if (!node.init) return;

      // const router = Router() or const router: Router = Router()
      if (
        node.init.type === 'CallExpression' &&
        ((node.init.callee.type === 'Identifier' && node.init.callee.name === 'Router') ||
          (node.init.callee.type === 'MemberExpression' &&
            node.init.callee.property.name === 'Router'))
      ) {
        routerVarNames.add(node.id.name);
      }

      // const app = express()
      if (
        node.init.type === 'CallExpression' &&
        node.init.callee.type === 'Identifier' &&
        node.init.callee.name === 'express'
      ) {
        routerVarNames.add(node.id.name);
      }
    },
  });

  // Extract route definitions
  traverse(ast, {
    CallExpression(path: any) {
      const { node } = path;

      if (
        node.callee.type !== 'MemberExpression' ||
        node.callee.property.type !== 'Identifier'
      ) return;

      const method = node.callee.property.name;
      if (!HTTP_METHODS.has(method)) return;

      const objectName =
        node.callee.object.type === 'Identifier' ? node.callee.object.name : null;

      if (!objectName || !routerVarNames.has(objectName)) return;

      // First arg should be the route path string
      if (node.arguments.length === 0 || node.arguments[0].type !== 'StringLiteral') return;

      const routePath = node.arguments[0].value;

      // Find the handler (last argument that's a function)
      const handlerNode = node.arguments[node.arguments.length - 1];
      let handlerCode = '';
      try {
        handlerCode = generate(handlerNode, { concise: false }).code;
      } catch {
        handlerCode = '// Could not extract handler';
      }

      // Extract middleware names (arguments between path and handler)
      const middlewares: string[] = [];
      for (let i = 1; i < node.arguments.length - 1; i++) {
        const arg = node.arguments[i];
        if (arg.type === 'Identifier') {
          middlewares.push(arg.name);
        }
      }

      // Detect params, query params, and body usage from handler code
      const params = extractPathParams(routePath);
      const queryParams = extractQueryParams(handlerCode);
      const hasBody = handlerCode.includes('req.body');

      // Determine mount prefix
      let prefix = '';
      // Check if this file's export is mounted somewhere
      for (const [varName, mountPrefix] of mountPrefixes) {
        // Heuristic: if the import path contains the filename stem
        const fileStem = fileName.split('/').pop()?.replace(/\.(ts|js|mjs)$/, '') || '';
        if (varName.toLowerCase().includes(fileStem.toLowerCase())) {
          prefix = mountPrefix;
          break;
        }
      }

      const fullPath = prefix + routePath;

      const auth = detectAuth(middlewares, handlerCode);

      routes.push({
        method: method.toUpperCase(),
        path: fullPath,
        handlerCode,
        middlewares,
        fileName,
        lineNumber: node.loc?.start.line || 0,
        params,
        queryParams,
        hasBody,
        auth,
      });
    },
  });

  return routes;
}

function extractPathParams(routePath: string): string[] {
  const matches = routePath.match(/:(\w+)/g);
  return matches ? matches.map(m => m.slice(1)) : [];
}

function extractQueryParams(handlerCode: string): string[] {
  const params: string[] = [];
  const regex = /req\.query\.(\w+)|req\.query\[['"](\w+)['"]\]|{\s*([^}]+)\s*}\s*=\s*req\.query/g;
  let match;
  while ((match = regex.exec(handlerCode)) !== null) {
    if (match[1]) params.push(match[1]);
    if (match[2]) params.push(match[2]);
    if (match[3]) {
      // Destructured: { category, page } = req.query
      match[3].split(',').forEach(p => {
        const trimmed = p.trim().split(/[:\s]/)[0];
        if (trimmed) params.push(trimmed);
      });
    }
  }
  return [...new Set(params)];
}

const AUTH_MIDDLEWARE_PATTERNS = [
  'auth', 'authenticate', 'protect', 'guard', 'verify',
  'jwt', 'passport', 'requireauth', 'ensureauth',
  'isauthenticated', 'isadmin', 'requirerole', 'checktoken',
];

function isAuthMiddleware(name: string): boolean {
  const lower = name.toLowerCase();
  return AUTH_MIDDLEWARE_PATTERNS.some(pattern => lower.includes(pattern));
}

function detectAuth(middlewares: string[], handlerCode: string): AuthInfo {
  const code = handlerCode;
  const authMiddleware = middlewares.find(isAuthMiddleware);

  // 1. JWT detection — middleware name or handler code
  if (authMiddleware && authMiddleware.toLowerCase().includes('jwt')) {
    return { type: 'jwt', middleware: authMiddleware, headerName: 'Authorization' };
  }
  if (/jwt\.verify|jsonwebtoken/.test(code)) {
    return { type: 'jwt', middleware: authMiddleware, headerName: 'Authorization' };
  }

  // 2. Passport detection
  if (authMiddleware && authMiddleware.toLowerCase().includes('passport')) {
    return { type: 'oauth2', middleware: authMiddleware };
  }
  if (/passport\.authenticate/.test(code)) {
    return { type: 'oauth2', middleware: authMiddleware };
  }

  // 3. API key header detection
  const apiKeyMatch = code.match(/req\.headers?\[['"]([xX]-[\w-]+)['"]\]|req\.header\(['"]([xX]-[\w-]+)['"]\)/);
  if (apiKeyMatch) {
    const headerName = apiKeyMatch[1] || apiKeyMatch[2];
    return { type: 'api-key', middleware: authMiddleware, headerName };
  }

  // 4. Bearer token detection
  if (/req\.headers\.authorization|req\.headers\[['"]authorization['"]\]/.test(code)) {
    if (/[Bb]earer/.test(code)) {
      return { type: 'bearer', middleware: authMiddleware, headerName: 'Authorization' };
    }
    // 5. Basic auth detection
    if (/[Bb]asic/.test(code)) {
      return { type: 'basic', middleware: authMiddleware, headerName: 'Authorization' };
    }
    // Authorization header present but no specific scheme found — default to bearer
    return { type: 'bearer', middleware: authMiddleware, headerName: 'Authorization' };
  }

  // 6. Upstream auth indicators (req.user, req.session)
  if (/req\.user/.test(code) && authMiddleware) {
    return { type: 'custom', middleware: authMiddleware };
  }
  if (/req\.session/.test(code) && authMiddleware) {
    return { type: 'custom', middleware: authMiddleware };
  }

  // 7. Auth-like middleware present but can't determine specific type
  if (authMiddleware) {
    return { type: 'custom', middleware: authMiddleware };
  }

  // 8. Fallback: check for auth indicators in code without middleware
  if (/req\.user/.test(code)) {
    return { type: 'custom' };
  }

  // No auth detected
  return { type: 'none' };
}
