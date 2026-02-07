export function buildOverviewPrompt(repoName: string, routes: { method: string; path: string; description?: string }[]): string {
  const routeList = routes.map(r => `- ${r.method} ${r.path}`).join('\n');

  return `Generate an API overview page for a REST API called "${repoName}" with these endpoints:

${routeList}

Generate a Markdown page with:
1. **API title** as h1 and a brief introduction paragraph
2. **Base URL** section with a placeholder like \`http://localhost:3000\`
3. **Quick Reference** — a markdown table of all endpoints: Method | Path | Description (infer short descriptions from the path names)
4. **Getting Started** — a short section with a simple example flow using curl

Keep it concise and practical. Do NOT wrap the output in a markdown code block. Output raw markdown directly.`;
}
