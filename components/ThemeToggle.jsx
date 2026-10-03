'use client';

import { Icon } from './Icons';

const STORAGE_KEY = 'reelsdl-theme';
const THEME_COLORS = { light: '#faf8fc', dark: '#0e0c13' };

function currentTheme() {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle({ label }) {
  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute('content', THEME_COLORS[next]);
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage blocked: theme still applies for this page view */
    }
  }

  // Both icons render; CSS shows the right one so the server markup never mismatches.
  return (
    <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={label} title={label}>
      <Icon name="moon" className="theme-icon-moon" />
      <Icon name="sun" className="theme-icon-sun" />
    </button>
  );
}
