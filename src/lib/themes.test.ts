// @vitest-environment jsdom
import {
  THEME_IDS,
  THEME_LABELS,
  TERMINAL_THEMES,
  applyTheme,
  getTheme,
  initTheme,
  isThemeId,
  onThemeChange,
  resolveTheme,
  watchSystemTheme,
  type ResolvedTheme,
} from './themes.ts';

function resetThemeState() {
  localStorage.removeItem('nixos-manager:theme');
  delete document.documentElement.dataset.theme;
}

beforeEach(resetThemeState);
afterEach(resetThemeState);

describe('isThemeId', () => {
  it('accepts known ids and rejects everything else', () => {
    expect(isThemeId('mocha')).toBe(true);
    expect(isThemeId('macchiato')).toBe(true);
    expect(isThemeId('latte')).toBe(true);
    expect(isThemeId('nord')).toBe(true);
    expect(isThemeId('system')).toBe(true);
    expect(isThemeId('dracula')).toBe(false);
    expect(isThemeId(null)).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('passes concrete themes through', () => {
    expect(resolveTheme('mocha')).toBe('mocha');
    expect(resolveTheme('latte')).toBe('latte');
    expect(resolveTheme('nord')).toBe('nord');
  });

  it('falls back to mocha when matchMedia is unavailable', () => {
    expect(resolveTheme('system')).toBe('mocha');
  });

  it('resolves system to latte when OS prefers light', () => {
    const stub = vi.fn().mockReturnValue({ matches: true });
    (window as any).matchMedia = stub;
    expect(resolveTheme('system')).toBe('latte');
    expect(stub).toHaveBeenCalledWith('(prefers-color-scheme: light)');
    delete (window as any).matchMedia;
  });
});

describe('getTheme / applyTheme / initTheme', () => {
  it('defaults to mocha with empty or corrupt storage', () => {
    expect(getTheme()).toBe('mocha');
    localStorage.setItem('nixos-manager:theme', 'bogus');
    expect(getTheme()).toBe('mocha');
  });

  it('applyTheme sets data-theme, persists the id, and notifies main', () => {
    const setTheme = vi.fn(async () => ({ success: true }));
    (window as any).electronAPI = { setTheme };
    try {
      const resolved = applyTheme('latte');
      expect(resolved).toBe('latte');
      expect(document.documentElement.dataset.theme).toBe('latte');
      expect(localStorage.getItem('nixos-manager:theme')).toBe('latte');
      expect(setTheme).toHaveBeenCalledWith('latte');
    } finally {
      delete (window as any).electronAPI;
    }
  });

  it('applyTheme stores the raw id (system), not the resolution', () => {
    applyTheme('system');
    expect(localStorage.getItem('nixos-manager:theme')).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('mocha');
  });

  it('applyTheme tolerates a missing electronAPI', () => {
    expect(() => applyTheme('nord')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('nord');
  });

  it('initTheme applies persisted theme without re-persisting', () => {
    localStorage.setItem('nixos-manager:theme', 'nord');
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    initTheme();
    expect(document.documentElement.dataset.theme).toBe('nord');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('onThemeChange', () => {
  it('delivers resolved themes to subscribers and stops after unsubscribe', () => {
    const seen: ResolvedTheme[] = [];
    const unwatch = onThemeChange((resolved) => seen.push(resolved));

    applyTheme('latte');
    applyTheme('nord');
    unwatch();
    applyTheme('mocha');

    expect(seen).toEqual(['latte', 'nord']);
  });
});

describe('watchSystemTheme', () => {
  it('re-applies on OS preference change while theme is system', () => {
    let listener: (() => void) | null = null;
    (window as any).matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: (_: string, cb: () => void) => { listener = cb; },
      removeEventListener: () => { listener = null; },
    }));
    (window as any).electronAPI = { setTheme: vi.fn(async () => ({ success: true })) };

    try {
      applyTheme('system');
      const unwatch = watchSystemTheme();
      listener!();
      expect(document.documentElement.dataset.theme).toBe('mocha');
      unwatch();
    } finally {
      delete (window as any).electronAPI;
      delete (window as any).matchMedia;
    }
  });

  it('does not override an explicit theme on OS changes', () => {
    let listener: (() => void) | null = null;
    (window as any).matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: (_: string, cb: () => void) => { listener = cb; },
      removeEventListener: () => { listener = null; },
    }));

    applyTheme('latte');
    const unwatch = watchSystemTheme();
    listener!();
    expect(document.documentElement.dataset.theme).toBe('latte');
    unwatch();
    delete (window as any).matchMedia;
  });
});

describe('theme registry consistency', () => {
  it('THEME_IDS and THEME_LABELS cover exactly the terminal palettes', () => {
    const paletteKeys = Object.keys(TERMINAL_THEMES).sort();
    const concreteIds = THEME_IDS.filter((id) => id !== 'system').sort();
    expect(concreteIds).toEqual(paletteKeys);
    for (const id of THEME_IDS) {
      expect(THEME_LABELS[id]).toBeTruthy();
    }
    expect(THEME_LABELS.system).toBe('Match system');
  });

  it('every terminal palette is complete', () => {
    const required = [
      'background', 'foreground', 'cursor', 'cursorAccent',
      'selectionBackground', 'selectionForeground',
      'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
      'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
      'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
    ];
    for (const [theme, palette] of Object.entries(TERMINAL_THEMES)) {
      for (const key of required) {
        expect(palette[key as keyof typeof palette]).toBeTruthy();
      }
    }
  });
});
