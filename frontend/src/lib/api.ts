const API_BASE = import.meta.env.VITE_API_URL || '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export interface AuthInfo {
  type: 'bearer' | 'api-key' | 'basic' | 'oauth2' | 'jwt' | 'custom' | 'none';
  middleware?: string;
  headerName?: string;
}

export interface ParsedRouteInfo {
  method: string;
  path: string;
  params: string[];
  queryParams: string[];
  hasBody: boolean;
  fileName: string;
  lineNumber: number;
  auth: AuthInfo;
}

export interface RepoResponse {
  repoId: string;
  name: string;
  expressFiles: number;
  routes: ParsedRouteInfo[];
}

export interface ProviderInfo {
  id: string;
  name: string;
  model: string;
  configured: boolean;
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

export interface AppSettings {
  defaultRenderer: 'scalar' | 'swagger' | 'redoc' | 'rapidoc' | 'stoplight' | 'hybrid';
  codeLanguages: string[];
  httpClient: string;
  authDisplay: string;
}

export const api = {
  ingestRepo: (url: string) =>
    request<RepoResponse>('/api/repos', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  listRepos: () => request<{ repoId: string; name: string; routeCount: number }[]>('/api/repos'),

  getRepo: (id: string) => request<any>(`/api/repos/${id}`),

  getProviders: () => request<ProviderInfo[]>('/api/providers'),

  getWikiStatus: () => request<{ connected: boolean }>('/api/providers/wiki-status'),

  getSettings: () => request<AppSettings>('/api/providers/settings'),

  updateSettings: (settings: Partial<AppSettings>) =>
    request<AppSettings>('/api/providers/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  generateDocs: (repoId: string, provider: string, onProgress: (p: GenerationProgress) => void, codeTargets?: string[]): (() => void) => {
    const controller = new AbortController();

    fetch(`${API_BASE}/api/docs/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoId, provider, codeTargets }),
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        onProgress({ step: 'error', progress: 0, message: err.error || 'Request failed' });
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              onProgress(data);
            } catch {}
          }
        }
      }
    }).catch((err) => {
      if (err.name !== 'AbortError') {
        onProgress({ step: 'error', progress: 0, message: err.message });
      }
    });

    return () => controller.abort();
  },
};
