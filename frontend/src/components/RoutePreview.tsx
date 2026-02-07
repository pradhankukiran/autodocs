import { ParsedRouteInfo } from '../lib/api';

interface Props {
  routes: ParsedRouteInfo[];
  repoName: string;
}

const methodColors: Record<string, string> = {
  GET: 'bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]',
  POST: 'bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]',
  PUT: 'bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A]',
  PATCH: 'bg-[#FFF7ED] text-[#EA580C] border border-[#FED7AA]',
  DELETE: 'bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]',
};

const authColors: Record<string, string> = {
  bearer: 'text-[#B45309]',
  jwt: 'text-[#B45309]',
  'api-key': 'text-[#7C3AED]',
  basic: 'text-[#EA580C]',
  oauth2: 'text-[#0891B2]',
  custom: 'text-[#BE185D]',
  none: 'text-cream-500',
};

const authLabels: Record<string, string> = {
  bearer: 'Bearer',
  jwt: 'JWT',
  'api-key': 'API Key',
  basic: 'Basic',
  oauth2: 'OAuth2',
  custom: 'Custom',
  none: '\u2014',
};

export default function RoutePreview({ routes, repoName }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[#1C1917]">
          Detected Routes — <span className="text-primary-600">{repoName}</span>
        </h3>
        <span className="text-xs text-cream-500">{routes.length} endpoints</span>
      </div>
      <div className="bg-white border border-cream-300 rounded-xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-cream-50 text-[#57534E] text-left">
              <th className="px-4 py-2.5 font-medium border-b border-cream-300">Method</th>
              <th className="px-4 py-2.5 font-medium border-b border-cream-300">Path</th>
              <th className="px-4 py-2.5 font-medium border-b border-cream-300">Auth</th>
              <th className="px-4 py-2.5 font-medium border-b border-cream-300">Params</th>
              <th className="px-4 py-2.5 font-medium border-b border-cream-300">Body</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cream-300">
            {routes.map((route, i) => (
              <tr key={i} className="hover:bg-cream-50">
                <td className="px-4 py-2.5">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-mono font-bold ${methodColors[route.method] || 'bg-cream-100 text-cream-500 border border-cream-300'}`}>
                    {route.method}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-[#1C1917]">{route.path}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-xs font-medium ${authColors[route.auth.type] || 'text-cream-500'}`}>
                    {authLabels[route.auth.type] || route.auth.type}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-cream-500">
                  {[...route.params, ...route.queryParams].join(', ') || <span className="text-cream-500">{'\u2014'}</span>}
                </td>
                <td className="px-4 py-2.5">
                  {route.hasBody ? (
                    <span className="text-xs text-[#2563EB]">JSON</span>
                  ) : (
                    <span className="text-cream-500">{'\u2014'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
