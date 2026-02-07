import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, Settings, Play } from 'lucide-react';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/playground', label: 'Playground', icon: Play },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Layout() {
  return (
    <div className="flex h-screen bg-cream-50 text-text-primary">
      {/* Sidebar */}
      <aside className="w-64 border-r border-cream-300 bg-cream-100 flex flex-col">
        {/* Brand */}
        <div className="px-5 py-6 border-b border-cream-300">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 shadow-card">
              <span className="text-sm font-bold text-white leading-none">A</span>
            </div>
            <div>
              <h1 className="font-display italic text-lg text-text-primary leading-tight">
                autodocs
              </h1>
              <p className="text-[11px] text-text-tertiary leading-tight mt-0.5">
                API Documentation
              </p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                [
                  'group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative',
                  isActive
                    ? 'bg-cream-200 text-primary-600 before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-r-full before:bg-primary-500'
                    : 'text-text-secondary hover:text-text-primary hover:bg-cream-200/50',
                ].join(' ')
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-cream-300">
          <p className="text-[11px] text-text-tertiary">autodocs v0.1.0</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-cream-50">
        <div className="max-w-5xl mx-auto p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
