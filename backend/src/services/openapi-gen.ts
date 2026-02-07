import type { ParsedRoute, AuthInfo } from './route-parser.js';

// Maps auth types to their OpenAPI security scheme key
function getSecurityKey(authType: AuthInfo['type']): string | null {
  switch (authType) {
    case 'bearer':
    case 'jwt':
    case 'custom':
      return 'bearerAuth';
    case 'api-key':
      return 'apiKeyAuth';
    case 'basic':
      return 'basicAuth';
    case 'oauth2':
      return 'oauth2';
    default:
      return null;
  }
}

export function generateOpenAPISpec(routes: ParsedRoute[], repoName: string): object {
  const paths: Record<string, Record<string, any>> = {};
  const usedSecuritySchemes = new Set<string>();

  for (const route of routes) {
    // Convert Express params (:id) to OpenAPI format ({id})
    const openApiPath = route.path.replace(/:(\w+)/g, '{$1}');

    if (!paths[openApiPath]) {
      paths[openApiPath] = {};
    }

    const operation: any = {
      summary: `${route.method} ${route.path}`,
      tags: [getResourceTag(route.path)],
      parameters: [],
      responses: {
        '200': { description: 'Successful response', content: { 'application/json': { schema: { type: 'object' } } } },
        '400': { description: 'Bad request' },
        '404': { description: 'Not found' },
        '500': { description: 'Internal server error' },
      },
    };

    // Add path parameters
    for (const param of route.params) {
      operation.parameters.push({
        name: param,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      });
    }

    // Add query parameters
    for (const param of route.queryParams) {
      operation.parameters.push({
        name: param,
        in: 'query',
        required: false,
        schema: { type: 'string' },
      });
    }

    // Add request body
    if (route.hasBody) {
      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object' },
          },
        },
      };
    }

    // Add security based on auth detection
    const securityKey = getSecurityKey(route.auth.type);
    if (securityKey) {
      operation.security = [{ [securityKey]: [] }];
      usedSecuritySchemes.add(securityKey);

      // Add 401 response for authenticated endpoints
      operation.responses['401'] = { description: 'Unauthorized' };
    } else {
      operation.security = [];
    }

    paths[openApiPath][route.method.toLowerCase()] = operation;
  }

  // Build security schemes — only include those actually used
  const allSchemes: Record<string, object> = {
    bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    basicAuth: { type: 'http', scheme: 'basic' },
    oauth2: {
      type: 'oauth2',
      flows: {
        implicit: {
          authorizationUrl: 'https://example.com/oauth/authorize',
          scopes: {},
        },
      },
    },
  };

  // Update apiKeyAuth name if a specific header was detected
  for (const route of routes) {
    if (route.auth.type === 'api-key' && route.auth.headerName) {
      (allSchemes.apiKeyAuth as any).name = route.auth.headerName;
      break;
    }
  }

  const securitySchemes: Record<string, object> = {};
  for (const key of usedSecuritySchemes) {
    securitySchemes[key] = allSchemes[key];
  }

  const spec: any = {
    openapi: '3.0.3',
    info: {
      title: `${repoName} API`,
      version: '1.0.0',
      description: `Auto-generated API documentation for ${repoName}`,
    },
    servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
    paths,
  };

  if (Object.keys(securitySchemes).length > 0) {
    spec.components = { securitySchemes };
  }

  return spec;
}

function getResourceTag(path: string): string {
  const parts = path.split('/').filter(Boolean);
  // Return the first non-param segment
  for (const part of parts) {
    if (!part.startsWith(':')) return part.charAt(0).toUpperCase() + part.slice(1);
  }
  return 'Default';
}
