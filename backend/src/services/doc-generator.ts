import type { ParsedRoute } from './route-parser.js';
import { generateCompletion } from './llm-orchestrator.js';
import { SYSTEM_PROMPT, buildEndpointPrompt } from '../prompts/endpoint-doc.js';
import { buildOverviewPrompt } from '../prompts/overview-doc.js';
import { buildCodeExamplesPrompt, CODE_EXAMPLES_SYSTEM_PROMPT, CodeTargetKey } from '../prompts/code-examples.js';
import * as wiki from './wiki-client.js';
import { generateOpenAPISpec } from './openapi-gen.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

type ProviderName = 'cerebras' | 'groq' | 'openrouter';

const DEFAULT_CODE_TARGETS: CodeTargetKey[] = ['javascript-fetch', 'python-requests', 'curl'];

const WIKI_UNIFIED_PAGE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Newsreader:ital,wght@0,500;0,600;1,500&display=swap');

:root {
  --ad-cream-50: #FAF7F2;
  --ad-cream-100: #F3EDE4;
  --ad-cream-300: #E6DED3;
  --ad-primary-600: #4A3B9B;
  --ad-text-primary: #1C1917;
  --ad-text-secondary: #57534E;
}

.contents,
.page-contents {
  font-family: "DM Sans", ui-sans-serif, system-ui, sans-serif;
  color: var(--ad-text-primary);
  line-height: 1.7;
}

.contents h1.toc-header,
.contents h2.toc-header,
.contents h3.toc-header,
.contents h4.toc-header,
.contents h5.toc-header,
.contents h6.toc-header,
.page-contents h1.toc-header,
.page-contents h2.toc-header,
.page-contents h3.toc-header,
.page-contents h4.toc-header,
.page-contents h5.toc-header,
.page-contents h6.toc-header {
  font-family: "Newsreader", Georgia, serif;
  color: var(--ad-text-primary);
  letter-spacing: -0.01em;
}

.contents h1.toc-header,
.page-contents h1.toc-header {
  border-bottom: 1px solid var(--ad-cream-300);
  padding-bottom: 0.35rem;
}

.contents p,
.contents li,
.page-contents p,
.page-contents li {
  color: var(--ad-text-secondary);
}

.contents a,
.page-contents a {
  color: var(--ad-primary-600);
  text-decoration-color: rgba(74, 59, 155, 0.35);
}

.contents code,
.page-contents code {
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--ad-cream-100);
  padding: 0.1rem 0.35rem;
  border-radius: 0.35rem;
}

.contents pre,
.page-contents pre {
  background: #fff;
  border: 1px solid var(--ad-cream-300);
  border-radius: 0.75rem;
  padding: 1rem;
}

.contents table,
.page-contents table {
  border-collapse: collapse;
  width: 100%;
}

.contents th,
.contents td,
.page-contents th,
.page-contents td {
  border: 1px solid var(--ad-cream-300);
  padding: 0.5rem 0.65rem;
}

.contents th,
.page-contents th {
  background: var(--ad-cream-100);
  color: var(--ad-text-primary);
}
`.trim();

export interface GenerationOptions {
  provider: ProviderName;
  codeTargets?: CodeTargetKey[];
}

export interface GenerationProgress {
  step: 'parsing' | 'generating' | 'publishing' | 'complete' | 'error';
  progress: number;
  message: string;
  current?: number;
  total?: number;
  endpoint?: string;
  wikiUrl?: string;
  pagesCreated?: number;
}

type ProgressCallback = (progress: GenerationProgress) => void;

// Group routes by their first path segment (resource)
function groupByResource(routes: ParsedRoute[]): Map<string, ParsedRoute[]> {
  const groups = new Map<string, ParsedRoute[]>();
  for (const route of routes) {
    const parts = route.path.split('/').filter(Boolean);
    const resource = parts[0] || 'root';
    if (!groups.has(resource)) groups.set(resource, []);
    groups.get(resource)!.push(route);
  }
  return groups;
}

export async function generateDocs(
  repoName: string,
  routes: ParsedRoute[],
  repoId: string,
  options: GenerationOptions,
  onProgress: ProgressCallback
): Promise<{ openApiSpec: object; pagesCreated: number }> {
  const { provider, codeTargets = DEFAULT_CODE_TARGETS } = options;
  const resourceGroups = groupByResource(routes);
  const totalSteps = routes.length + 2; // endpoints + overview + publishing
  let currentStep = 0;

  const generatedDocs = new Map<string, string>(); // resource -> markdown

  // Generate docs for each endpoint
  for (const [resource, resourceRoutes] of resourceGroups) {
    let resourceDoc = `# ${resource.charAt(0).toUpperCase() + resource.slice(1)} Endpoints\n\n`;

    for (const route of resourceRoutes) {
      currentStep++;
      onProgress({
        step: 'generating',
        progress: Math.round((currentStep / totalSteps) * 80),
        message: `Generating docs for ${route.method} ${route.path}`,
        current: currentStep,
        total: routes.length,
        endpoint: `${route.method} ${route.path}`,
      });

      try {
        const prompt = buildEndpointPrompt(route);
        const { content } = await generateCompletion(SYSTEM_PROMPT, prompt, provider);
        resourceDoc += content + '\n\n';

        // Generate code examples via a second LLM call
        if (codeTargets.length > 0) {
          try {
            const codePrompt = buildCodeExamplesPrompt(route, codeTargets);
            const { content: codeContent } = await generateCompletion(
              CODE_EXAMPLES_SYSTEM_PROMPT,
              codePrompt,
              provider
            );
            resourceDoc += '## Code Examples\n\n' + codeContent + '\n\n';
          } catch (codeErr) {
            logger.error({ route: route.path, err: codeErr }, 'Failed to generate code examples');
            resourceDoc += '## Code Examples\n\n*Code example generation failed.*\n\n';
          }
        }

        resourceDoc += '---\n\n';
      } catch (err) {
        logger.error({ route: route.path, err }, 'Failed to generate endpoint doc');
        resourceDoc += `### ${route.method} ${route.path}\n\n*Documentation generation failed.*\n\n---\n\n`;
      }

      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    generatedDocs.set(resource, resourceDoc);
  }

  // Generate overview page
  currentStep++;
  onProgress({
    step: 'generating',
    progress: Math.round((currentStep / totalSteps) * 80),
    message: 'Generating API overview page',
  });

  let overviewDoc: string;
  try {
    const overviewPrompt = buildOverviewPrompt(repoName, routes);
    const { content } = await generateCompletion(SYSTEM_PROMPT, overviewPrompt, provider);
    overviewDoc = content;
  } catch {
    overviewDoc = `# ${repoName} API\n\nAPI documentation auto-generated by autodocs.\n`;
  }

  // Add links to resource pages and playground
  overviewDoc += '\n\n## Endpoint Groups\n\n';
  for (const resource of resourceGroups.keys()) {
    overviewDoc += `- [${resource.charAt(0).toUpperCase() + resource.slice(1)}](/en/api-docs/${repoName}/endpoints/${resource})\n`;
  }
  overviewDoc += `\n## Interactive Playground\n\n[Open API Playground](${config.frontendUrl}/playground?repoId=${encodeURIComponent(repoId)}&renderer=rapidoc)\n`;

  // Generate OpenAPI spec (before Wiki.js publish so it's available even if Wiki.js is down)
  const openApiSpec = generateOpenAPISpec(routes, repoName);

  // Publish to Wiki.js (non-fatal — playground works without it)
  onProgress({
    step: 'publishing',
    progress: 85,
    message: 'Publishing to Wiki.js...',
  });

  let pagesCreated = 0;

  try {
    // Create overview page
    await wiki.upsertPage({
      path: `api-docs/${repoName}`,
      title: `${repoName} API Documentation`,
      content: overviewDoc,
      tags: ['autodocs', repoName],
      scriptCss: WIKI_UNIFIED_PAGE_CSS,
    });
    pagesCreated++;

    // Create resource pages
    for (const [resource, content] of generatedDocs) {
      await wiki.upsertPage({
        path: `api-docs/${repoName}/endpoints/${resource}`,
        title: `${resource.charAt(0).toUpperCase() + resource.slice(1)} — ${repoName} API`,
        content,
        tags: ['autodocs', repoName, resource],
        scriptCss: WIKI_UNIFIED_PAGE_CSS,
      });
      pagesCreated++;
    }
  } catch (err) {
    logger.error({ err }, 'Failed to publish to Wiki.js (playground will still work)');
    onProgress({
      step: 'publishing',
      progress: 90,
      message: 'Wiki.js publish failed — playground still available',
    });
  }

  onProgress({
    step: 'complete',
    progress: 100,
    message: pagesCreated > 0
      ? 'Documentation generated successfully!'
      : 'Documentation generated! (Wiki.js publish skipped — playground available)',
    wikiUrl: pagesCreated > 0 ? `api-docs/${repoName}` : undefined,
    pagesCreated,
  });

  return { openApiSpec, pagesCreated };
}
