import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/svelte';

describe('application entry point', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
  });

  it('mounts the Svelte 5 application without the legacy component API', async () => {
    await import('./main');

    await waitFor(() => {
      expect(document.querySelector('h1')?.textContent?.trim()).toBe(
        'PR Wranglomat',
      );
    });

    const reference =
      document.querySelector<HTMLDetailsElement>('.field-reference');
    expect(reference?.open).toBe(false);
    reference?.querySelector('summary')?.click();
    expect(reference?.open).toBe(true);
    expect(reference?.textContent).toContain('review_state');
    expect(reference?.textContent).toContain('ORDER BY');
  });
});
