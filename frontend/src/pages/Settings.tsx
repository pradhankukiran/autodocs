import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, AppSettings } from '../lib/api';
import { CheckCircle2, XCircle, ExternalLink, Palette, Code2, Shield } from 'lucide-react';

const WIKI_BASE_URL = import.meta.env.VITE_WIKI_URL || 'http://localhost:3000';

const RENDERERS: { id: AppSettings['defaultRenderer']; name: string; description: string }[] = [
  { id: 'scalar', name: 'Scalar', description: 'Modern, clean API reference with built-in testing' },
  { id: 'swagger', name: 'Swagger UI', description: 'Industry-standard interactive API explorer' },
  { id: 'redoc', name: 'Redoc', description: 'Clean three-panel documentation layout' },
  { id: 'rapidoc', name: 'RapiDoc', description: 'Customizable web component for API docs' },
  { id: 'stoplight', name: 'Stoplight Elements', description: 'Developer portal-style documentation' },
  { id: 'hybrid', name: 'Hybrid', description: 'Combined Scalar reference + Swagger try-it-out' },
];

const CODE_LANGUAGES: { id: string; label: string }[] = [
  { id: 'javascript-fetch', label: 'JavaScript (fetch)' },
  { id: 'javascript-axios', label: 'JavaScript (axios)' },
  { id: 'javascript-node-fetch', label: 'Node.js (node-fetch)' },
  { id: 'python-requests', label: 'Python (requests)' },
  { id: 'python-httpx', label: 'Python (httpx)' },
  { id: 'python-aiohttp', label: 'Python (aiohttp)' },
  { id: 'curl', label: 'cURL' },
  { id: 'php-guzzle', label: 'PHP (Guzzle)' },
  { id: 'ruby-httparty', label: 'Ruby (HTTParty)' },
  { id: 'go-net-http', label: 'Go (net/http)' },
  { id: 'java-okhttp', label: 'Java (OkHttp)' },
  { id: 'java-httpclient', label: 'Java (HttpClient)' },
  { id: 'csharp-httpclient', label: 'C# (HttpClient)' },
  { id: 'rust-reqwest', label: 'Rust (reqwest)' },
  { id: 'typescript-fetch', label: 'TypeScript (fetch)' },
];

const AUTH_OPTIONS: { id: string; label: string }[] = [
  { id: 'api_key', label: 'API Key' },
  { id: 'bearer', label: 'Bearer Token' },
  { id: 'basic', label: 'Basic Auth' },
  { id: 'oauth2', label: 'OAuth 2.0' },
  { id: 'jwt', label: 'JWT' },
  { id: 'custom_headers', label: 'Custom Headers' },
];

export default function Settings() {
  const queryClient = useQueryClient();

  const { data: providers } = useQuery({
    queryKey: ['providers'],
    queryFn: api.getProviders,
  });

  const { data: wikiStatus } = useQuery({
    queryKey: ['wiki-status'],
    queryFn: api.getWikiStatus,
    refetchInterval: 10000,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  });

  const settingsMutation = useMutation({
    mutationFn: api.updateSettings,
    onMutate: async (newSettings) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] });
      const previous = queryClient.getQueryData<AppSettings>(['settings']);
      queryClient.setQueryData<AppSettings>(['settings'], (old) => ({
        ...old!,
        ...newSettings,
      }));
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['settings'], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const updateSetting = (patch: Partial<AppSettings>) => {
    settingsMutation.mutate(patch);
  };

  const toggleLanguage = (langId: string) => {
    const current = settings?.codeLanguages ?? [];
    const updated = current.includes(langId)
      ? current.filter((l) => l !== langId)
      : [...current, langId];
    updateSetting({ codeLanguages: updated });
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h2 className="font-display text-2xl font-semibold text-[#1C1917]">Settings</h2>
        <p className="text-sm text-[#57534E] mt-1">
          Configure LLM providers, Wiki.js connection, and documentation options
        </p>
      </div>

      {/* Wiki.js Status */}
      <section className="bg-white border border-cream-300 rounded-xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-4">
        <h3 className="text-sm font-semibold text-[#1C1917]">Wiki.js Connection</h3>
        <div className="flex items-center gap-3">
          {wikiStatus?.connected ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-[#0F766E]" />
              <span className="text-sm font-medium text-[#0F766E]">Connected</span>
            </>
          ) : (
            <>
              <XCircle className="w-5 h-5 text-[#DC2626]" />
              <span className="text-sm font-medium text-[#DC2626]">Not connected</span>
            </>
          )}
          <a
            href={WIKI_BASE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs text-[#57534E] hover:text-primary-600 flex items-center gap-1 transition-colors"
          >
            Open Wiki.js <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <p className="text-xs text-cream-500">
          Set WIKI_API_TOKEN in your .env file. Generate it from Wiki.js Admin &gt; API Access.
        </p>
      </section>

      {/* LLM Providers */}
      <section className="bg-white border border-cream-300 rounded-xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-4">
        <h3 className="text-sm font-semibold text-[#1C1917]">LLM Providers</h3>
        <div className="space-y-3">
          {providers?.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between p-3 bg-cream-50 border border-cream-300 rounded-lg"
            >
              <div className="flex items-center gap-3">
                {p.configured ? (
                  <CheckCircle2 className="w-4 h-4 text-[#0F766E]" />
                ) : (
                  <XCircle className="w-4 h-4 text-cream-500" />
                )}
                <div>
                  <p className="text-sm font-medium text-[#1C1917]">{p.name}</p>
                  <p className="text-xs text-[#57534E]">{p.model}</p>
                </div>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded border ${
                p.configured
                  ? 'bg-[#F0FDF9] text-[#0F766E] border-[#A7F3D0]'
                  : 'bg-cream-50 text-cream-500 border-cream-300'
              }`}>
                {p.configured ? 'Configured' : 'Missing API key'}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-cream-500">
          Set API keys in your .env file: CEREBRAS_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY
        </p>
      </section>

      {/* API Playground Renderer */}
      <section className="bg-white border border-cream-300 rounded-xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-4">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-primary-600" />
          <h3 className="text-sm font-semibold text-[#1C1917]">API Playground Renderer</h3>
        </div>
        <p className="text-xs text-cream-500">
          Choose how your generated API documentation is displayed in the playground.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {RENDERERS.map((r) => (
            <button
              key={r.id}
              onClick={() => updateSetting({ defaultRenderer: r.id })}
              className={`text-left p-4 rounded-lg border transition-colors ${
                settings?.defaultRenderer === r.id
                  ? 'border-primary-600 bg-primary-50'
                  : 'border-cream-300 bg-white hover:border-cream-400'
              }`}
            >
              <p className={`text-sm font-medium ${
                settings?.defaultRenderer === r.id ? 'text-primary-600' : 'text-[#1C1917]'
              }`}>
                {r.name}
              </p>
              <p className="text-xs text-[#57534E] mt-1">{r.description}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Code Example Languages */}
      <section className="bg-white border border-cream-300 rounded-xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-4">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-primary-600" />
          <h3 className="text-sm font-semibold text-[#1C1917]">Code Example Languages</h3>
        </div>
        <p className="text-xs text-cream-500">
          Select which language/library combinations to include in generated code examples.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {CODE_LANGUAGES.map((lang) => {
            const isSelected = settings?.codeLanguages?.includes(lang.id) ?? false;
            return (
              <label
                key={lang.id}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  isSelected
                    ? 'border-primary-600 bg-primary-50'
                    : 'border-cream-300 bg-white hover:border-cream-400'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleLanguage(lang.id)}
                  className="sr-only"
                />
                <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                  isSelected
                    ? 'bg-primary-600 border-primary-600'
                    : 'border-cream-400 bg-white'
                }`}>
                  {isSelected && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className={`text-sm ${isSelected ? 'text-primary-600' : 'text-[#1C1917]'}`}>
                  {lang.label}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      {/* Authentication Display */}
      <section className="bg-white border border-cream-300 rounded-xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary-600" />
          <h3 className="text-sm font-semibold text-[#1C1917]">Authentication Display</h3>
        </div>
        <p className="text-xs text-cream-500">
          Auto-detected from code. This sets the default for endpoints without clear auth patterns.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {AUTH_OPTIONS.map((auth) => (
            <button
              key={auth.id}
              onClick={() => updateSetting({ authDisplay: auth.id })}
              className={`text-left p-3 rounded-lg border transition-colors ${
                settings?.authDisplay === auth.id
                  ? 'border-primary-600 bg-primary-50'
                  : 'border-cream-300 bg-white hover:border-cream-400'
              }`}
            >
              <p className={`text-sm font-medium ${
                settings?.authDisplay === auth.id ? 'text-primary-600' : 'text-[#1C1917]'
              }`}>
                {auth.label}
              </p>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
