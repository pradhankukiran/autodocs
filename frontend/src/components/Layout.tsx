import { Outlet, NavLink, Link } from 'react-router-dom';
import { Settings } from 'lucide-react';

export default function Layout() {
  return (
    <div className="h-screen overflow-y-auto bg-cream-50 text-text-primary">
      <div className="max-w-5xl mx-auto px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <Link to="/" className="font-display italic text-2xl font-semibold text-text-primary leading-tight">
            autodocs
          </Link>

          <NavLink
            to="/settings"
            className={({ isActive }) =>
              [
                'flex items-center justify-center w-8 h-8 rounded-lg transition-colors',
                isActive
                  ? 'bg-cream-200 text-primary-600'
                  : 'text-text-secondary hover:text-text-primary hover:bg-cream-200/50',
              ].join(' ')
            }
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </NavLink>
        </div>

        {/* Content */}
        <Outlet />
      </div>
    </div>
  );
}
