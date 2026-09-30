import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { load, save } from './storage';

type Choice = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

interface ThemeValue {
  choice: Choice;
  resolved: Resolved;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function systemTheme(): Resolved {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<Choice>(() => {
    const saved = load('theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });
  const [system, setSystem] = useState<Resolved>(systemTheme);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved = choice === 'system' ? system : choice;

  useEffect(() => {
    const root = document.documentElement;
    if (choice === 'system') delete root.dataset.theme;
    else root.dataset.theme = choice;
  }, [choice]);

  const value = useMemo<ThemeValue>(
    () => ({
      choice,
      resolved,
      toggle: () => {
        const next: Resolved = resolved === 'dark' ? 'light' : 'dark';
        save('theme', next);
        setChoice(next);
      },
    }),
    [choice, resolved],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme outside ThemeProvider');
  return ctx;
}

/** Chart colours per theme; keep in sync with the CSS custom properties. */
export const CHART_COLORS: Record<Resolved, { en: string; hi: string; grid: string; text: string }> = {
  light: { en: '#1E5AA8', hi: '#B4235A', grid: '#D9DCE5', text: '#5B6078' },
  dark: { en: '#7FA8E8', hi: '#E07AA2', grid: '#2E3258', text: '#A3A8C8' },
};
