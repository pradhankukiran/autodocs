import { useQuery } from '@tanstack/react-query';
import { api, ProviderInfo } from '../lib/api';
import { Cpu, CheckCircle2, XCircle } from 'lucide-react';

interface Props {
  value: string;
  onChange: (provider: string) => void;
}

export default function ProviderSelect({ value, onChange }: Props) {
  const { data: providers } = useQuery({
    queryKey: ['providers'],
    queryFn: api.getProviders,
  });

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-[#1C1917]">
        <Cpu className="inline-block w-4 h-4 mr-1.5 text-cream-500" />
        LLM Provider
      </label>
      <div className="flex gap-3">
        {providers?.map((p: ProviderInfo) => (
          <button
            key={p.id}
            onClick={() => onChange(p.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-colors ${
              value === p.id
                ? 'border-primary-600 bg-primary-50 text-primary-600'
                : p.configured
                ? 'border-cream-300 bg-white text-[#1C1917] hover:border-cream-400'
                : 'border-cream-300 bg-cream-50 text-cream-500 cursor-not-allowed'
            }`}
            disabled={!p.configured}
          >
            {p.configured ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-[#0F766E]" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-cream-500" />
            )}
            <span className="font-medium">{p.name}</span>
            <span className="text-xs text-[#57534E]">{p.model}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
