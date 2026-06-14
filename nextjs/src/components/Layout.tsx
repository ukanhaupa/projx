'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getUserInfo, logout } from '../lib/auth';
import { useTheme } from './ThemeProvider';

const COLLAPSED_KEY = 'sidebar-collapsed';

const NAV_ITEMS = [{ href: '/', label: 'Dashboard', icon: '■' }];

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

export function Layout({ children }: { children: React.ReactNode }) {
  const user = getUserInfo();
  const { theme, toggle } = useTheme();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () =>
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(COLLAPSED_KEY) === 'true',
  );

  const closeSidebar = () => setSidebarOpen(false);
  useCloseOnRouteChange(sidebarOpen, closeSidebar, pathname);

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
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role='listitem'
              className={pathname === item.href ? 'active' : undefined}
            >
              <span className='nav-icon' aria-hidden='true'>
                {item.icon}
              </span>
              <span className='nav-label'>{item.label}</span>
            </Link>
          ))}
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
        {children}
      </main>
    </div>
  );
}
