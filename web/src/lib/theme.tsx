'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from '@/components/icons';

export type Theme = 'system' | 'light' | 'dark';
const KEY = 'awb.theme';

/**
 * Runs before hydration so the first paint already has the right palette.
 * Kept as a string because it has to be inlined into <head>.
 */
export const themeBootScript = `(function(){try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})()`;

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const saved = (localStorage.getItem(KEY) as Theme | null) ?? 'system';
    setTheme(saved);
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    localStorage.setItem(KEY, next);
    apply(next);
  };

  return (
    <div className="segmented" role="group" aria-label="Colour theme">
      {(
        [
          ['light', Sun, 'Light'],
          ['system', Monitor, 'System'],
          ['dark', Moon, 'Dark'],
        ] as const
      ).map(([value, Icon, label]) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={theme === value}
          className={theme === value ? 'active' : ''}
          onClick={() => choose(value)}
        >
          <Icon size={13} />
        </button>
      ))}
    </div>
  );
}
