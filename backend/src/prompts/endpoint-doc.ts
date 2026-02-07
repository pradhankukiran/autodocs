import type { AuthInfo } from '../services/route-parser.js';

export const SYSTEM_PROMPT = `You are a senior API documentation writer. You produce clear, accurate, developer-friendly API documentation in Markdown format. Your documentation follows these principles:
- Start with a concise description of what the endpoint does
- Include all parameters with types, constraints, and defaults
- Provide realistic request/response examples with actual JSON
- Note error cases and status codes
- Use consistent formatting across all endpoints
- Be specific about authentication requirements if visible in the code`;

export function buildEndpointPrompt(route: {
  method: string;
  path: string;
  handlerCode: string;
  params: string[];
  queryParams: string[];
  hasBody: boolean;
  middlewares: string[];
  fileName: string;
  lineNumber: number;
  auth: AuthInfo;
}): string {
  return `Generate API documentation for this Express.js endpoint.

## Endpoint Details
- **Method**: ${route.method}
- **Path**: ${route.path}
- **Source**: ${route.fileName}:${route.lineNumber}

## Handler Source Code
\`\`\`javascript
${route.handlerCode}
\`\`\`

## Detected Parameters
- Path params: ${route.params.length > 0 ? route.params.join(', ') : 'none'}
- Query params: ${route.queryParams.length > 0 ? route.queryParams.join(', ') : 'none'}
- Has request body: ${route.hasBody ? 'yes' : 'no'}
- Middleware: ${route.middlewares.length > 0 ? route.middlewares.join(', ') : 'none'}

## Authentication
- Type: ${route.auth.type}
- Middleware: ${route.auth.middleware || 'none'}
- Header: ${route.auth.headerName || 'N/A'}

## Instructions
Generate Markdown documentation with these sections:
1. **Endpoint title** as an h3 heading (e.g., "### Create User")
2. **Description** - 1-2 sentences about what it does (infer from the code)
3. Method and path in a code block: \`${route.method} ${route.path}\`
4. **Path Parameters** table (Name | Type | Required | Description) — only if there are path params
5. **Query Parameters** table — only if there are query params
6. **Request Body** — JSON schema with field descriptions — only if the endpoint uses req.body
7. **Authentication** — describe what auth is required (if any), with example headers
8. **Success Response** — Example JSON response with realistic data
9. **Error Responses** — Common error codes and their meanings
10. **Code Examples** section will be appended separately

Include an **Authentication** section describing what auth is required (if any), with example headers.
Be specific and infer types/behavior from the handler code. Keep it concise.
Do NOT wrap the output in a markdown code block. Output raw markdown directly.`;
}
