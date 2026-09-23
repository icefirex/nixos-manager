// Theme store: persistence, application, and live-change notifications.
// Tokens live in CSS (:root / :root[data-theme='latte']); this module only
// manages WHICH theme is active and notifies JS consumers (xterm).

export type ResolvedTheme = 'mocha' | 'latte';
export type ThemeId = ResolvedTheme | 'system';

const STORAGE_KEY = 'nixos-manager:theme';
export const THEME_IDS: ThemeId[] = ['mocha', 'latte', 'system'];

export function isThemeId(value: unknown): value is ThemeId {
  return value === 'mocha' || value === 'latte' || value === 'system';
}

/** Resolve 'system' against the OS preference; pass-through otherwise. */
export function resolveTheme(id: ThemeId): ResolvedTheme {
  if (id !== 'system') return id;
  const prefersLight =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches;
  return prefersLight ? 'latte' : 'mocha';
}

export function getTheme(): ThemeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isThemeId(raw) ? raw : 'mocha';
  } catch {
    return 'mocha';
  }
}

/** Apply a theme: set data-theme, persist, notify listeners + main process. */
export function applyTheme(id: ThemeId): ResolvedTheme {
  const resolved = resolveTheme(id);
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {}
  document.documentElement.dataset.theme = resolved;
  document.dispatchEvent(new CustomEvent('theme-changed', { detail: { id, resolved } }));
  // Persist for native window background on next launch (best-effort)
  try {
    window.electronAPI?.setTheme?.(resolved);
  } catch {}
  return resolved;
}

/** Apply the persisted theme without re-persisting (boot path). */
export function initTheme(): ResolvedTheme {
  const id = getTheme();
  const resolved = resolveTheme(id);
  document.documentElement.dataset.theme = resolved;
  try {
    window.electronAPI?.setTheme?.(resolved);
  } catch {}
  return resolved;
}

/** Subscribe to live theme changes. Returns an unsubscribe function. */
export function onThemeChange(cb: (resolved: ResolvedTheme) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent).detail.resolved);
  document.addEventListener('theme-changed', handler);
  return () => document.removeEventListener('theme-changed', handler);
}

/** Follow OS preference while theme is 'system'. Call once at boot. */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const listener = () => {
    if (getTheme() === 'system') {
      applyTheme('system');
    }
  };
  mq.addEventListener('change', listener);
  return () => mq.removeEventListener('change', listener);
}

export interface TerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/** xterm.js palettes per resolved theme (kept in sync with styles.css tokens). */
export const TERMINAL_THEMES: Record<ResolvedTheme, TerminalPalette> = {
  mocha: {
    background: '#11111b',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    cursorAccent: '#11111b',
    selectionBackground: 'rgba(137, 180, 250, 0.3)',
    selectionForeground: '#cdd6f4',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#cba6f7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#cba6f7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8',
  },
  latte: {
    background: '#eff1f5',
    foreground: '#4c4f69',
    cursor: '#dc8a78',
    cursorAccent: '#eff1f5',
    selectionBackground: 'rgba(30, 102, 245, 0.3)',
    selectionForeground: '#4c4f69',
    black: '#5c5f77',
    red: '#d20f39',
    green: '#40a02b',
    yellow: '#df8e1d',
    blue: '#1e66f5',
    magenta: '#8839ef',
    cyan: '#179299',
    white: '#acb0be',
    brightBlack: '#9ca0b0',
    brightRed: '#e64553',
    brightGreen: '#40a02b',
    brightYellow: '#df8e1d',
    brightBlue: '#1e66f5',
    brightMagenta: '#ea76cb',
    brightCyan: '#179299',
    brightWhite: '#4c4f69',
  },
};

export const THEME_LABELS: Record<ThemeId, string> = {
  mocha: 'Catppuccin Mocha (dark)',
  latte: 'Catppuccin Latte (light)',
  system: 'Match system',
};
