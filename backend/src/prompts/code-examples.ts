export const CODE_TARGETS = {
  'javascript-fetch': { language: 'JavaScript', library: 'Fetch API', label: 'JavaScript (fetch)' },
  'javascript-axios': { language: 'JavaScript', library: 'Axios', label: 'JavaScript (axios)' },
  'javascript-node-fetch': { language: 'JavaScript', library: 'node-fetch', label: 'Node.js (node-fetch)' },
  'python-requests': { language: 'Python', library: 'requests', label: 'Python (requests)' },
  'python-httpx': { language: 'Python', library: 'httpx', label: 'Python (httpx)' },
  'python-aiohttp': { language: 'Python', library: 'aiohttp', label: 'Python (aiohttp)' },
  'curl': { language: 'Shell', library: 'cURL', label: 'cURL' },
  'php-guzzle': { language: 'PHP', library: 'Guzzle', label: 'PHP (Guzzle)' },
  'ruby-httparty': { language: 'Ruby', library: 'HTTParty', label: 'Ruby (HTTParty)' },
  'go-net-http': { language: 'Go', library: 'net/http', label: 'Go (net/http)' },
  'java-okhttp': { language: 'Java', library: 'OkHttp', label: 'Java (OkHttp)' },
  'java-httpclient': { language: 'Java', library: 'HttpClient', label: 'Java (HttpClient)' },
  'csharp-httpclient': { language: 'C#', library: 'HttpClient', label: 'C# (HttpClient)' },
  'rust-reqwest': { language: 'Rust', library: 'reqwest', label: 'Rust (reqwest)' },
  'typescript-fetch': { language: 'TypeScript', library: 'Fetch API', label: 'TypeScript (fetch)' },
} as const;

export type CodeTargetKey = keyof typeof CODE_TARGETS;

export const CODE_EXAMPLES_SYSTEM_PROMPT = `You are an expert developer who writes idiomatic HTTP client code in many languages. You produce clean, production-quality code examples for API documentation. Your examples:
- Use realistic placeholder values (e.g., "acme-corp", 42, "jane@example.com")
- Include the full HTTP request with method, URL, headers, and body where applicable
- Include error handling where idiomatic for the language
- Are concise with no unnecessary comments
- Follow each language's conventions and best practices`;

export function buildCodeExamplesPrompt(route: {
  method: string;
  path: string;
  params: string[];
  queryParams: string[];
  hasBody: boolean;
  auth?: { type: string; headerName?: string };
}, targets: CodeTargetKey[]): string {
  const targetDescriptions = targets.map(key => {
    const target = CODE_TARGETS[key];
    return `- **${target.label}**: language=${target.language}, library=${target.library}`;
  }).join('\n');

  const paramInfo = route.params.length > 0
    ? `Path parameters: ${route.params.join(', ')}`
    : 'No path parameters';

  const queryInfo = route.queryParams.length > 0
    ? `Query parameters: ${route.queryParams.join(', ')}`
    : 'No query parameters';

  const bodyInfo = route.hasBody
    ? 'This endpoint accepts a JSON request body.'
    : 'This endpoint does not accept a request body.';

  return `Generate code examples for calling this API endpoint using each of the listed languages/libraries.

## Endpoint
- **Method**: ${route.method}
- **Path**: ${route.path}
- **Base URL**: http://localhost:3000
- ${paramInfo}
- ${queryInfo}
- ${bodyInfo}

## Authentication
${route.auth && route.auth.type !== 'none'
  ? `- Type: ${route.auth.type}\n- Header: ${route.auth.headerName || 'Authorization'}\nInclude the appropriate authentication header in each example.`
  : 'No authentication required.'}

## Requested Code Examples
${targetDescriptions}

## Output Format
For each requested target, output a section in exactly this format:

### {label}

\`\`\`{language_lowercase}
{code}
\`\`\`

Where:
- {label} is the exact label from the list above (e.g., "JavaScript (fetch)")
- {language_lowercase} is the language name in lowercase for the code fence (e.g., "javascript", "python", "shell", "php", "ruby", "go", "java", "csharp", "rust", "typescript")
- {code} is the complete, runnable code example

## Rules
- Use realistic placeholder values for path params and query params (not "string" or "value")
- If the endpoint accepts a body, include a realistic JSON body
- Include Content-Type header for requests with a body
- Include error handling where idiomatic for the language
- Keep examples concise — no unnecessary comments or explanations
- Output the examples in the same order as listed above
- Do NOT wrap the entire output in a markdown code block. Output raw markdown directly.`;
}
