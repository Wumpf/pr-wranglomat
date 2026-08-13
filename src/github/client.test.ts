import { describe, expect, it, vi } from 'vitest';
import { GitHubClient } from './client';
it('sends PAT only as an authorization header and exposes rate limit', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response('{"ok":true}', {
      status: 200,
      headers: { 'x-ratelimit-remaining': '42' },
    }),
  );
  const result = await new GitHubClient(
    'https://api.github.com',
    fetcher,
  ).request('/x', { kind: 'pat', token: 'secret' });
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer secret');
  expect(result.rateLimitRemaining).toBe(42);
});

describe('GitHub errors', () => {
  it('preserves a zero limit and does not expose response bodies', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response('{"message":"private details"}', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
      }),
    );
    const request = new GitHubClient('https://api.github.com', fetcher).request(
      '/x',
      undefined,
      undefined,
      1,
    );
    await expect(request).rejects.toMatchObject({
      code: 'rate-limited',
      message: 'GitHub rate limit exceeded.',
    });
    await expect(request).rejects.not.toThrow(/private details/);
  });

  it('classifies unauthorized requests without leaking the body', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('secret response', { status: 401 }));
    await expect(
      new GitHubClient('https://api.github.com', fetcher).request(
        '/x',
        undefined,
        undefined,
        1,
      ),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects pagination links to another origin before sending a token', async () => {
    const fetcher = vi.fn();
    await expect(
      new GitHubClient('https://api.github.com', fetcher).request(
        'https://example.com/steal',
        { kind: 'pat', token: 'secret' },
      ),
    ).rejects.toMatchObject({ code: 'invalid-response' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps an aborted request to cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi
      .fn()
      .mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    await expect(
      new GitHubClient('https://api.github.com', fetcher).request(
        '/x',
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
  });
});
