import { GenerationProgress } from '../lib/api';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface Props {
  progress: GenerationProgress | null;
  repoId?: string;
  renderer?: string;
}

const WIKI_BASE_URL = import.meta.env.VITE_WIKI_URL || 'http://localhost:3000';

export default function DocStatus({ progress, repoId, renderer }: Props) {
  if (!progress) return null;

  const isComplete = progress.step === 'complete';
  const isError = progress.step === 'error';

  const effectiveRepoId = repoId || new URLSearchParams(window.location.search).get('repoId') || '';
  const effectiveRenderer = renderer || 'rapidoc';
  const playgroundUrl = `/playground?repoId=${encodeURIComponent(effectiveRepoId)}&renderer=${encodeURIComponent(effectiveRenderer)}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {isComplete ? (
          <CheckCircle2 className="w-4 h-4 text-[#0F766E]" />
        ) : isError ? (
          <AlertCircle className="w-4 h-4 text-[#DC2626]" />
        ) : (
          <Loader2 className="w-4 h-4 text-primary-600 animate-spin" />
        )}
        <span className={`text-sm ${isError ? 'text-[#DC2626]' : 'text-[#1C1917]'}`}>
          {progress.message}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-cream-300 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isError ? 'bg-[#DC2626]' : isComplete ? 'bg-[#0F766E]' : 'bg-primary-600'
          }`}
          style={{ width: `${progress.progress}%` }}
        />
      </div>

      {/* Current endpoint being documented */}
      {progress.endpoint && (
        <p className="text-xs text-[#57534E] font-mono">
          {progress.current}/{progress.total}: {progress.endpoint}
        </p>
      )}

      {/* Results */}
      {isComplete && (
        <div className="flex gap-3 mt-4">
          {progress.wikiUrl && (
            <a
              href={`${WIKI_BASE_URL}/en/${progress.wikiUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#0F766E] hover:bg-[#0D6560] text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              Open Wiki.js Docs ({progress.pagesCreated} pages)
            </a>
          )}
          <a
            href={playgroundUrl}
            className="bg-primary-600 hover:bg-primary-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            Open API Playground
          </a>
        </div>
      )}
    </div>
  );
}
