import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { getUserInfo, logout } from '../auth';
import { useTheme } from '../theme';

const COLLAPSED_KEY = 'sidebar-collapsed';

function useCloseOnRouteChange(
  open: boolean,
  close: () => void,
  pathname: string,
) {
  const [prev, setPrev] = useState(pathname);
  if (pathname !== prev) {
    setPrev(pathname);
    if (open) close();
  }
}

export function Layout() {
  const user = getUserInfo();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === 'true',
  );

  const closeSidebar = () => setSidebarOpen(false);
  useCloseOnRouteChange(sidebarOpen, closeSidebar, location.pathname);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSED_KEY, String(!c));
      return !c;
    });
  };

  useEffect(() => {
    if (!sidebarOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  return (
    <div className={`layout ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <a href='#main-content' className='skip-link'>
        Skip to main content
      </a>

      {sidebarOpen && (
        <div
          className='sidebar-backdrop'
          onClick={closeSidebar}
          aria-hidden='true'
        />
      )}

      <nav
        className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}
        aria-label='Main navigation'
      >
        <div className='sidebar-header'>
          <span className='sidebar-title'>Project Template</span>
          <div className='sidebar-header-actions'>
            <button
              className='theme-toggle'
              onClick={toggle}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            >
              {theme === 'light' ? '☾' : '☀'}
            </button>
            <button
              className='collapse-toggle'
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
            >
              {collapsed ? '❯' : '❮'}
            </button>
          </div>
        </div>

        <div className='sidebar-nav' role='list'>
          <NavLink to='/' end role='listitem'>
            <span className='nav-icon' aria-hidden='true'>
              {'■'}
            </span>
            <span className='nav-label'>Dashboard</span>
          </NavLink>
        </div>

        <div className='sidebar-footer'>
          <span className='nav-label'>{user.name}</span>
          <button onClick={logout} aria-label='Log out'>
            <span className='nav-label'>Logout</span>
          </button>
        </div>
      </nav>

      <main id='main-content' className='content'>
        <button
          className='mobile-menu-btn'
          onClick={() => setSidebarOpen(true)}
          aria-label='Open navigation menu'
          aria-expanded={sidebarOpen}
          aria-controls='sidebar-nav'
        >
          &#9776;
        </button>
        <Outlet />
      </main>
    </div>
  );
}
