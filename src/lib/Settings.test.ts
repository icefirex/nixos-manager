// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/svelte';
import Settings from './Settings.svelte';

function resetThemeState() {
  localStorage.removeItem('nixos-manager:theme');
  delete document.documentElement.dataset.theme;
}

beforeEach(resetThemeState);
afterEach(resetThemeState);

describe('Settings page', () => {
  it('renders a heading and a theme selector with all five options', () => {
    render(Settings);
    expect(screen.getByText('Settings')).toBeTruthy();
    const select = screen.getByLabelText('Theme') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(['mocha', 'macchiato', 'nord', 'latte', 'system']);
  });

  it('reflects the persisted theme on mount', () => {
    localStorage.setItem('nixos-manager:theme', 'nord');
    render(Settings);
    const select = screen.getByLabelText('Theme') as HTMLSelectElement;
    expect(select.value).toBe('nord');
  });

  it('applies and persists the theme on change', async () => {
    render(Settings);
    const select = screen.getByLabelText('Theme') as HTMLSelectElement;

    await fireEvent.change(select, { target: { value: 'latte' } });

    expect(select.value).toBe('latte');
    expect(document.documentElement.dataset.theme).toBe('latte');
    expect(localStorage.getItem('nixos-manager:theme')).toBe('latte');
    expect(screen.getByText('Theme saved')).toBeTruthy();
  });

  it('changing to a concrete theme applies it directly', async () => {
    render(Settings);
    const select = screen.getByLabelText('Theme') as HTMLSelectElement;

    await fireEvent.change(select, { target: { value: 'macchiato' } });
    expect(document.documentElement.dataset.theme).toBe('macchiato');
  });
});
