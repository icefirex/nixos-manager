// @vitest-environment jsdom
import { render, fireEvent } from '@testing-library/svelte';
import ActionCard from './ActionCard.svelte';

describe('ActionCard', () => {
  it('renders title and description', () => {
    const { getByText } = render(ActionCard, {
      type: 'primary',
      icon: 'Rocket',
      title: 'Rebuild',
      description: 'Apply configuration',
      onclick: () => {},
    });
    expect(getByText('Rebuild')).toBeTruthy();
    expect(getByText('Apply configuration')).toBeTruthy();
  });

  it('invokes onclick when clicked', async () => {
    let clicked = 0;
    const { getByRole } = render(ActionCard, {
      type: 'primary',
      icon: 'Rocket',
      title: 'Rebuild',
      description: 'Apply configuration',
      onclick: () => { clicked += 1; },
    });
    await fireEvent.click(getByRole('button'));
    expect(clicked).toBe(1);
  });

  it('renders a disabled button when disabled is set', () => {
    const { getByRole } = render(ActionCard, {
      type: 'danger',
      icon: 'Trash2',
      title: 'Delete',
      description: 'Remove',
      onclick: () => {},
      disabled: true,
    });
    const button = getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
