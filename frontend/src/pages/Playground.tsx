import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Loader2, AlertCircle, FileText } from 'lucide-react';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function apiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path;
}

const RENDERER_OPTIONS = [
  { value: 'scalar', label: 'Scalar' },
  { value: 'swagger', label: 'Swagger UI' },
  { value: 'redoc', label: 'Redoc' },
  { value: 'rapidoc', label: 'RapiDoc' },
  { value: 'stoplight', label: 'Stoplight Elements' },
  { value: 'hybrid', label: 'Hybrid (Redoc + Swagger)' },
] as const;

type RendererType = (typeof RENDERER_OPTIONS)[number]['value'];

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

function loadCSS(href: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`link[href="${href}"]`)) {
      resolve();
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to load stylesheet: ${href}`));
    document.head.appendChild(link);
  });
}

function renderScalar(container: HTMLDivElement, specJson: object): void {
  container.innerHTML = '';
  const el = document.createElement('div');
  el.id = 'scalar-root';
  container.appendChild(el);
  (window as any).Scalar.createApiReference('#scalar-root', {
    content: specJson,
    theme: 'default',
  });
}

function renderSwagger(container: HTMLDivElement, specJson: object): void {
  container.innerHTML = '';
  const el = document.createElement('div');
  el.id = 'swagger-root';
  container.appendChild(el);
  const SwaggerUIBundle = (window as any).SwaggerUIBundle;
  const SwaggerUIStandalonePreset = (window as any).SwaggerUIStandalonePreset;
  SwaggerUIBundle({
    spec: specJson,
    dom_id: '#swagger-root',
    deepLinking: true,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: 'StandaloneLayout',
  });
}

function renderRedoc(container: HTMLDivElement, specJson: object): void {
  container.innerHTML = '';
  const el = document.createElement('div');
  el.id = 'redoc-root';
  container.appendChild(el);
  (window as any).Redoc.init(specJson, {}, el);
}

function renderRapidoc(container: HTMLDivElement, specJson: object): void {
  container.innerHTML = '';
  const el = document.createElement('rapi-doc');
  el.id = 'rapidoc';
  el.setAttribute('theme', 'light');
  el.setAttribute('render-style', 'read');
  el.setAttribute('show-header', 'false');
  el.setAttribute('bg-color', '#FAF7F2');
  el.setAttribute('primary-color', '#5746AF');
  el.setAttribute('nav-bg-color', '#F3EDE4');
  el.setAttribute('nav-text-color', '#57534E');
  el.setAttribute('nav-accent-color', '#5746AF');
  container.appendChild(el);
  requestAnimationFrame(() => {
    (el as any).loadSpec(specJson);
  });
}

function renderStoplight(container: HTMLDivElement, specJson: object): void {
  container.innerHTML = '';
  const el = document.createElement('elements-api');
  el.setAttribute('apiDescriptionDocument', JSON.stringify(specJson));
  el.setAttribute('router', 'hash');
  el.setAttribute('layout', 'sidebar');
  container.appendChild(el);
}

function renderHybrid(
  container: HTMLDivElement,
  specJson: object,
  onCleanup: (fn: () => void) => void,
): void {
  container.innerHTML = '';

  // Build the hybrid layout
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;height:100%;';

  const redocPanel = document.createElement('div');
  redocPanel.id = 'hybrid-redoc';
  redocPanel.style.cssText = 'flex:1;overflow-y:auto;';
  wrapper.appendChild(redocPanel);

  container.appendChild(wrapper);

  // Render Redoc
  (window as any).Redoc.init(specJson, {}, redocPanel);

  // "Try It" button
  const tryBtn = document.createElement('button');
  tryBtn.textContent = 'Try It';
  tryBtn.className =
    'fixed bottom-6 right-6 z-50 bg-primary-600 hover:bg-primary-700 text-white font-medium text-sm rounded-xl px-6 py-3 shadow-lg cursor-pointer transition-colors';
  document.body.appendChild(tryBtn);

  // Overlay
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm hidden';
  overlay.style.cssText = 'display:none;';

  // Slide-out panel
  const panel = document.createElement('div');
  panel.className =
    'absolute top-0 right-0 w-[55%] min-w-[480px] max-w-[900px] h-full bg-white shadow-xl overflow-y-auto';
  panel.style.animation = 'hybrid-slide-in 0.2s ease-out';

  // Inject keyframes if not already present
  if (!document.getElementById('hybrid-slide-keyframes')) {
    const style = document.createElement('style');
    style.id = 'hybrid-slide-keyframes';
    style.textContent =
      '@keyframes hybrid-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }';
    document.head.appendChild(style);
  }

  // Panel header
  const panelHeader = document.createElement('div');
  panelHeader.className =
    'sticky top-0 z-10 flex items-center justify-between px-5 py-3 bg-cream-100 border-b border-cream-300';

  const panelTitle = document.createElement('span');
  panelTitle.className = 'text-sm font-semibold text-[#1C1917]';
  panelTitle.textContent = 'Swagger UI — Try Endpoints';
  panelHeader.appendChild(panelTitle);

  const closeBtn = document.createElement('button');
  closeBtn.className =
    'text-xs font-medium text-[#57534E] hover:text-[#1C1917] bg-white border border-cream-300 rounded-lg px-3 py-1.5 cursor-pointer transition-colors';
  closeBtn.textContent = 'Close';
  panelHeader.appendChild(closeBtn);

  const panelContent = document.createElement('div');
  panelContent.id = 'swagger-panel-content';

  panel.appendChild(panelHeader);
  panel.appendChild(panelContent);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  let swaggerInitialized = false;

  const openOverlay = () => {
    overlay.style.display = 'block';
    if (!swaggerInitialized) {
      swaggerInitialized = true;
      const SwaggerUIBundle = (window as any).SwaggerUIBundle;
      const SwaggerUIStandalonePreset = (window as any).SwaggerUIStandalonePreset;
      SwaggerUIBundle({
        spec: specJson,
        dom_id: '#swagger-panel-content',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: 'StandaloneLayout',
      });
    }
  };

  const closeOverlay = () => {
    overlay.style.display = 'none';
  };

  tryBtn.addEventListener('click', openOverlay);
  closeBtn.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeOverlay();
  });

  const handleEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && overlay.style.display === 'block') {
      closeOverlay();
    }
  };
  document.addEventListener('keydown', handleEsc);

  // Cleanup callback: remove the body-appended elements
  onCleanup(() => {
    tryBtn.remove();
    overlay.remove();
    document.removeEventListener('keydown', handleEsc);
  });
}

export default function Playground() {
  const [searchParams, setSearchParams] = useSearchParams();
  const repoId = searchParams.get('repoId');
  const rendererParam = searchParams.get('renderer') || 'rapidoc';

  const [currentRenderer, setCurrentRenderer] = useState<RendererType>(
    rendererParam as RendererType,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [specJson, setSpecJson] = useState<object | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const hybridCleanupRef = useRef<(() => void) | null>(null);

  // Sync renderer state from URL params
  useEffect(() => {
    const r = searchParams.get('renderer') || 'rapidoc';
    if (RENDERER_OPTIONS.some((opt) => opt.value === r)) {
      setCurrentRenderer(r as RendererType);
    }
  }, [searchParams]);

  // Handle renderer switching
  const handleRendererChange = useCallback(
    (newRenderer: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('renderer', newRenderer);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Fetch spec when repoId changes
  useEffect(() => {
    if (!repoId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSpecJson(null);

    fetch(apiUrl(`/api/docs/openapi/${encodeURIComponent(repoId)}`))
      .then((res) => {
        if (!res.ok) throw new Error(`Spec not found (HTTP ${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setSpecJson(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load API specification');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoId]);

  // Render the spec when specJson or renderer changes
  useEffect(() => {
    if (!specJson || !containerRef.current) return;

    const container = containerRef.current;

    // Clean up previous hybrid elements
    if (hybridCleanupRef.current) {
      hybridCleanupRef.current();
      hybridCleanupRef.current = null;
    }

    // Clear container
    container.innerHTML = '';

    const renderSpec = async () => {
      try {
        switch (currentRenderer) {
          case 'scalar':
            await loadScript('https://cdn.jsdelivr.net/npm/@scalar/api-reference');
            renderScalar(container, specJson);
            break;

          case 'swagger':
            await Promise.all([
              loadScript(
                'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js',
              ),
              loadScript(
                'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js',
              ),
              loadCSS(
                'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css',
              ),
            ]);
            renderSwagger(container, specJson);
            break;

          case 'redoc':
            await loadScript(
              'https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js',
            );
            renderRedoc(container, specJson);
            break;

          case 'rapidoc':
            await loadScript(
              'https://cdn.jsdelivr.net/npm/rapidoc@9/dist/rapidoc-min.js',
            );
            renderRapidoc(container, specJson);
            break;

          case 'stoplight':
            await Promise.all([
              loadScript(
                'https://cdn.jsdelivr.net/npm/@stoplight/elements@8/web-components.min.js',
              ),
              loadCSS(
                'https://cdn.jsdelivr.net/npm/@stoplight/elements@8/styles.min.css',
              ),
            ]);
            renderStoplight(container, specJson);
            break;

          case 'hybrid':
            await Promise.all([
              loadScript(
                'https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js',
              ),
              loadScript(
                'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js',
              ),
              loadScript(
                'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js',
              ),
              loadCSS(
                'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css',
              ),
            ]);
            renderHybrid(container, specJson, (fn) => {
              hybridCleanupRef.current = fn;
            });
            break;
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load renderer');
      }
    };

    renderSpec();

    return () => {
      container.innerHTML = '';
      if (hybridCleanupRef.current) {
        hybridCleanupRef.current();
        hybridCleanupRef.current = null;
      }
    };
  }, [specJson, currentRenderer]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-[#1C1917]">
            API Playground
          </h2>
          {repoId && (
            <p className="text-sm text-[#57534E] mt-1">
              Viewing documentation for{' '}
              <span className="font-mono text-xs bg-cream-200 px-1.5 py-0.5 rounded">
                {repoId}
              </span>
            </p>
          )}
        </div>

        {repoId && (
          <div className="flex items-center gap-2 shrink-0">
            <label
              htmlFor="renderer-select"
              className="text-xs font-semibold uppercase tracking-wider text-cream-500"
            >
              Renderer
            </label>
            <select
              id="renderer-select"
              value={currentRenderer}
              onChange={(e) => handleRendererChange(e.target.value)}
              className="bg-white border border-cream-300 rounded-lg text-[#1C1917] text-sm px-3 py-1.5 outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-600/20 transition-colors"
            >
              {RENDERER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Content */}
      {!repoId ? (
        <div className="flex items-center justify-center min-h-[calc(100vh-16rem)]">
          <div className="bg-white border border-cream-300 rounded-xl p-10 shadow-[0_1px_3px_rgba(0,0,0,0.04)] text-center max-w-md">
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 rounded-xl bg-cream-100 flex items-center justify-center">
                <FileText className="w-6 h-6 text-cream-500" />
              </div>
            </div>
            <h3 className="font-display text-lg font-semibold text-[#1C1917] mb-2">
              No repository specified
            </h3>
            <p className="text-sm text-[#57534E] mb-6">
              Generate documentation from the Dashboard first, then view it here
              in the API Playground.
            </p>
            <Link
              to="/"
              className="inline-flex items-center px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-16rem)] gap-4">
          <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
          <p className="text-sm text-[#57534E]">Loading API documentation...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-16rem)] gap-4">
          <div className="w-12 h-12 rounded-full bg-[#FEF2F2] flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-[#DC2626]" />
          </div>
          <div className="text-center">
            <h3 className="font-display text-lg font-semibold text-[#1C1917] mb-1">
              Failed to load documentation
            </h3>
            <p className="text-sm text-[#57534E]">{error}</p>
          </div>
          <button
            onClick={() => {
              setError(null);
              setSpecJson(null);
              setLoading(true);
              fetch(apiUrl(`/api/docs/openapi/${encodeURIComponent(repoId!)}`))
                .then((res) => {
                  if (!res.ok) throw new Error(`Spec not found (HTTP ${res.status})`);
                  return res.json();
                })
                .then((data) => {
                  setSpecJson(data);
                  setLoading(false);
                })
                .catch((err) => {
                  setError(err.message || 'Failed to load API specification');
                  setLoading(false);
                });
            }}
            className="text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors"
          >
            Try again
          </button>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="bg-white border border-cream-300 rounded-xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)] min-h-[calc(100vh-12rem)]"
        />
      )}
    </div>
  );
}
