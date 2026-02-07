import { useState, useCallback, useRef, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, RepoResponse, GenerationProgress } from '../lib/api';
import RepoForm from '../components/RepoForm';
import RoutePreview from '../components/RoutePreview';
import ProviderSelect from '../components/ProviderSelect';
import DocStatus from '../components/DocStatus';

const RENDERER_OPTIONS = [
  { value: 'scalar', label: 'Scalar' },
  { value: 'swagger', label: 'Swagger UI' },
  { value: 'redoc', label: 'Redoc' },
  { value: 'rapidoc', label: 'RapiDoc' },
  { value: 'stoplight', label: 'Stoplight Elements' },
  { value: 'hybrid', label: 'Hybrid (Redoc + Swagger)' },
] as const;

export default function Dashboard() {
  const [repo, setRepo] = useState<RepoResponse | null>(null);
  const [provider, setProvider] = useState('cerebras');
  const [selectedRenderer, setSelectedRenderer] = useState('');
  const [genProgress, setGenProgress] = useState<GenerationProgress | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  });

  // Sync renderer selection from settings when loaded
  const resolvedRenderer = selectedRenderer || settings?.defaultRenderer || 'rapidoc';

  const ingestMutation = useMutation({
    mutationFn: api.ingestRepo,
    onSuccess: (data) => {
      setRepo(data);
      setGenProgress(null);
      toast.success(`Found ${data.routes.length} routes in ${data.expressFiles} files`);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleGenerate = useCallback(() => {
    if (!repo) return;

    // Cancel any previous generation
    cancelRef.current?.();

    setIsGenerating(true);
    setGenProgress({ step: 'parsing', progress: 0, message: 'Starting...' });

    const codeTargets = settings?.codeLanguages;

    const cancel = api.generateDocs(repo.repoId, provider, (progress) => {
      setGenProgress(progress);
      if (progress.step === 'complete' || progress.step === 'error') {
        setIsGenerating(false);
        if (progress.step === 'complete') {
          toast.success(`Generated ${progress.pagesCreated} doc pages!`);
        }
      }
    }, codeTargets);

    cancelRef.current = cancel;
  }, [repo, provider, settings]);

  useEffect(() => {
    return () => { cancelRef.current?.(); };
  }, []);

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div>
        <p className="text-sm text-[#57534E]">
          Connect a repository to auto-generate API documentation
        </p>
      </div>

      {/* Step 1: Connect Repository */}
      <section className="bg-white border border-cream-300 rounded-xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-cream-500">
          Step 1 — Connect Repository
        </h3>
        <RepoForm
          onSubmit={(url) => ingestMutation.mutate(url)}
          isLoading={ingestMutation.isPending}
        />
      </section>

      {/* Step 2: Review Detected Endpoints */}
      {repo && (
        <section className="bg-white border border-cream-300 rounded-xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-cream-500">
            Step 2 — Review Detected Endpoints
          </h3>
          <RoutePreview routes={repo.routes} repoName={repo.name} />
        </section>
      )}

      {/* Step 3: Generate Documentation */}
      {repo && repo.routes.length > 0 && (
        <section className="bg-white border border-cream-300 rounded-xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-cream-500">
            Step 3 — Generate Documentation
          </h3>

          <ProviderSelect value={provider} onChange={setProvider} />

          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold uppercase tracking-wider text-cream-500">
              API Renderer
            </label>
            <select
              value={resolvedRenderer}
              onChange={(e) => setSelectedRenderer(e.target.value)}
              className="bg-white border border-cream-300 text-[#1C1917] text-sm rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-primary-600/20 focus:border-primary-600 transition-colors"
            >
              {RENDERER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {settings?.defaultRenderer && settings.defaultRenderer !== resolvedRenderer && (
              <span className="text-xs text-cream-500">
                Default: {RENDERER_OPTIONS.find((o) => o.value === settings.defaultRenderer)?.label ?? settings.defaultRenderer}
              </span>
            )}
          </div>

          {settings?.codeLanguages && settings.codeLanguages.length > 0 && (
            <p className="text-xs text-cream-500">
              Code examples: {settings.codeLanguages.length} language{settings.codeLanguages.length !== 1 ? 's' : ''} selected
            </p>
          )}

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="px-6 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:bg-cream-300 disabled:text-cream-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isGenerating ? 'Generating...' : 'Generate Documentation'}
          </button>

          <DocStatus progress={genProgress} repoId={repo?.repoId} renderer={resolvedRenderer} />
        </section>
      )}
    </div>
  );
}
