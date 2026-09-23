// @vitest-environment jsdom
import { render, fireEvent } from '@testing-library/svelte';
import Sidebar from './Sidebar.svelte';

describe('Sidebar', () => {
  it('renders nav tooltips for primary and secondary items', () => {
    const { getByText } = render(Sidebar, { currentPage: 'dashboard' });
    expect(getByText('Dashboard')).toBeTruthy();
    expect(getByText('Discover')).toBeTruthy();
    expect(getByText('Packages')).toBeTruthy();
    expect(getByText('Options')).toBeTruthy();
    expect(getByText('Changes')).toBeTruthy();
    expect(getByText('History')).toBeTruthy();
    expect(getByText('Settings')).toBeTruthy();
  });

  it('marks the current page active', () => {
    const { getByText } = render(Sidebar, { currentPage: 'packages' });
    const btn = getByText('Packages').closest('button') as HTMLButtonElement;
    expect(btn.className).toContain('active');
  });

  it('navigates when a nav button is clicked', async () => {
    const { getByText } = render(Sidebar, { currentPage: 'dashboard' });
    await fireEvent.click(getByText('Options').closest('button') as HTMLButtonElement);
    const optionsBtn = getByText('Options').closest('button') as HTMLButtonElement;
    expect(optionsBtn.className).toContain('active');
  });

  it('navigates to the settings page from the footer button', async () => {
    const { getByText } = render(Sidebar, { currentPage: 'dashboard' });
    const settingsBtn = getByText('Settings').closest('button') as HTMLButtonElement;
    expect(settingsBtn.className).not.toContain('coming-soon');
    await fireEvent.click(settingsBtn);
    expect(settingsBtn.className).toContain('active');
  });

  it('keeps coming-soon items non-interactive', () => {
    const { getByText } = render(Sidebar, { currentPage: 'dashboard' });
    const rebuild = getByText('Rebuild (coming soon)').closest('button') as HTMLButtonElement;
    expect(rebuild.className).toContain('coming-soon');
    expect(rebuild.onclick).toBe(null);
  });
});
