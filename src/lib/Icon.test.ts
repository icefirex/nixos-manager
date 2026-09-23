// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import Icon from './Icon.svelte';

describe('Icon', () => {
  it('renders an svg for a known icon name', () => {
    const { container } = render(Icon, { name: 'Home' });
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders nothing for an unknown icon name', () => {
    const { container } = render(Icon, { name: 'NotARealIcon' });
    expect(container.querySelector('svg')).toBe(null);
  });

  it('applies the requested size', () => {
    const { container } = render(Icon, { name: 'Settings', size: 32 });
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('width')).toBe('32');
    expect(svg.getAttribute('height')).toBe('32');
  });
});
