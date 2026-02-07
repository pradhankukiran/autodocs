import { useState } from 'react';
import { FolderGit2, Loader2 } from 'lucide-react';

interface Props {
  onSubmit: (url: string) => void;
  isLoading: boolean;
}

export default function RepoForm({ onSubmit, isLoading }: Props) {
  const [url, setUrl] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) onSubmit(url.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="block text-sm font-medium text-[#1C1917]">
        Repository URL or local path
      </label>
      <div className="flex gap-3">
        <div className="relative flex-1">
          <FolderGit2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cream-500" />
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/user/repo or /path/to/local/repo"
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-cream-300 rounded-lg text-sm text-[#1C1917] placeholder-cream-500 focus:outline-none focus:ring-2 focus:ring-primary-600/20 focus:border-primary-600 transition-colors"
            disabled={isLoading}
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || !url.trim()}
          className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:bg-cream-300 disabled:text-cream-500 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Scanning...
            </>
          ) : (
            'Scan Repository'
          )}
        </button>
      </div>
    </form>
  );
}
