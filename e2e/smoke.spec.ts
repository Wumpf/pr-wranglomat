import { test, expect, type Page } from '@playwright/test';

const pullRequest = (number: number, title: string, labels: string[]) => ({
  number,
  html_url: `https://github.com/acme/app/pull/${number}`,
  title,
  state: 'open',
  draft: false,
  user: { login: 'alice' },
  labels: labels.map((name) => ({ name })),
  assignees: [],
  requested_reviewers: [{ login: 'bob' }],
  requested_teams: [],
  base: { ref: 'main' },
  head: { ref: `branch-${number}` },
  milestone: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-10T00:00:00Z',
  closed_at: null,
  merged_at: null,
});

const graphPullRequest = (
  number: number,
  title: string,
  reviewDecision: 'APPROVED' | 'REVIEW_REQUIRED',
  draft = false,
) => ({
  number,
  url: `https://github.com/acme/app/pull/${number}`,
  title,
  state: 'OPEN',
  reviewDecision,
  isDraft: draft,
  author: { login: 'alice' },
  labels: {
    nodes: [{ name: number === 1 ? 'bug' : 'feature' }],
    pageInfo: { hasNextPage: false },
  },
  assignees: { nodes: [], pageInfo: { hasNextPage: false } },
  reviewRequests: {
    nodes: [{ requestedReviewer: { login: 'bob' } }],
    pageInfo: { hasNextPage: false },
  },
  reviews: {
    nodes: [
      {
        author: { login: 'carol' },
        state: reviewDecision === 'APPROVED' ? 'APPROVED' : 'COMMENTED',
      },
    ],
    pageInfo: { hasNextPage: false },
  },
  baseRefName: 'main',
  headRefName: `branch-${number}`,
  milestone: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-10T00:00:00Z',
  closedAt: null,
  mergedAt: null,
});

async function mockGitHub(page: Page) {
  await page.route('https://api.github.com/**', async (route) => {
    const request = route.request();
    const cors = {
      'access-control-allow-origin': 'http://127.0.0.1:4173',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Authorization, Accept, Content-Type',
      'access-control-expose-headers': 'Link, X-RateLimit-Remaining',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const url = new URL(request.url());
    expect(request.headers().authorization).toBe('Bearer test-token');
    if (url.pathname === '/graphql') {
      expect(request.postData()).toContain('reviewDecision');
      expect(request.postData()).toContain('reviews(first:100');
      await route.fulfill({
        headers: cors,
        json: {
          data: {
            repository: {
              pullRequests: {
                nodes: [
                  graphPullRequest(1, 'Fix crash', 'REVIEW_REQUIRED'),
                  graphPullRequest(2, 'Add feature', 'APPROVED', true),
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
            rateLimit: {
              cost: 1,
              remaining: 4995,
              resetAt: '2030-01-01T00:00:00Z',
            },
          },
        },
      });
      return;
    }
    if (url.pathname === '/user') {
      await route.fulfill({ headers: cors, json: { login: 'octocat' } });
      return;
    }
    if (url.pathname === '/rate_limit') {
      await route.fulfill({
        headers: cors,
        json: { rate: { remaining: 4998, reset: 2_000_000_000 } },
      });
      return;
    }
    if (url.pathname === '/repos/acme/app') {
      await route.fulfill({
        headers: cors,
        json: {
          id: 7,
          full_name: 'acme/app',
          visibility: 'private',
          default_branch: 'main',
        },
      });
      return;
    }
    if (url.pathname === '/repos/acme/app/pulls') {
      const pageNumber = url.searchParams.get('page');
      await route.fulfill({
        headers: {
          ...cors,
          'content-type': 'application/json',
          'x-ratelimit-remaining': pageNumber === '2' ? '4996' : '4997',
          ...(pageNumber === '2'
            ? {}
            : {
                link: '<https://api.github.com/repos/acme/app/pulls?state=all&per_page=100&page=2>; rel="next"',
              }),
        },
        body: JSON.stringify(
          pageNumber === '2'
            ? [
                {
                  ...pullRequest(2, 'Add feature', ['feature']),
                  draft: true,
                },
              ]
            : [pullRequest(1, 'Fix crash', ['bug'])],
        ),
      });
      return;
    }
    await route.abort();
  });
}

test('refreshes, preserves an invalid draft, reloads, and filters offline', async ({
  page,
  context,
}) => {
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text());
  });
  page.on('requestfailed', (request) =>
    console.error(request.url(), request.failure()?.errorText),
  );
  await mockGitHub(page);
  await page.goto('/');
  await page.getByLabel('Personal access token').fill('test-token');
  await page.getByRole('button', { name: 'Validate token' }).click();
  await expect(page.getByText(/octocat.*4998 remaining/)).toBeVisible();

  await page.getByLabel('Repository').fill('acme/app');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: /Refresh/ }).click();
  await expect(page.getByRole('link', { name: /#1 Fix crash/ })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /#2 Add feature/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Open', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Draft', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('columnheader', { name: 'Requested' }),
  ).toBeVisible();
  await expect(
    page.getByRole('columnheader', { name: 'Review activity' }),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: '@bob' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Import' })).toHaveCount(0);
  await expect(page.getByText(/2 PRs/).first()).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Unavailable', exact: true }).first(),
  ).toBeVisible();

  await page.getByLabel('Transport').selectOption('graphql');
  await page.getByRole('button', { name: /Refresh/ }).click();
  await expect(
    page.getByRole('cell', { name: 'Review required', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Approved', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: /@carol Commented/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByText('Approved', { exact: true }).last(),
  ).toBeVisible();
  const quickFilter = page.getByLabel('Filter expression');
  await expect(page.getByLabel('Filter name')).toHaveValue('My filter');
  await quickFilter.fill('review_state = "approved"');
  await expect(
    page.getByRole('link', { name: /#2 Add feature/ }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /#1 Fix crash/ })).toHaveCount(0);
  await quickFilter.fill('');

  const historyWarning = page.getByText(
    /snapshot omits some closed and merged/i,
  );
  await expect(historyWarning).toBeVisible();
  await page.getByLabel('Download scope').selectOption('complete');
  await expect(historyWarning).toBeVisible();
  await page.getByLabel('Download scope').selectOption('recent');
  await page.getByLabel('Closed days').fill('120');
  await page.getByLabel('Closed days').blur();
  await page.getByLabel('Transport').selectOption('graphql');
  await expect(page.getByText('Download preferences saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Download scope')).toHaveValue('recent');
  await expect(page.getByLabel('Closed days')).toHaveValue('120');
  await expect(page.getByLabel('Transport')).toHaveValue('graphql');
  await expect(historyWarning).toBeVisible();

  await page.getByRole('button', { name: 'New filter', exact: true }).click();
  await expect(page.getByLabel('Filter name')).toHaveValue('New filter');
  await page.getByRole('button', { name: 'Keep on top' }).click();
  await expect(
    page.getByRole('button', { name: 'Remove from top' }),
  ).toBeVisible();
  const editor = page.getByLabel('Filter expression');
  await editor.fill('state = "open"');
  await expect(page.getByText(/^Saved\./)).toBeVisible({ timeout: 2_000 });

  await editor.fill('draft = false');
  await page.getByLabel('Saved filter').selectOption({ label: 'My filter' });
  await expect(editor).toHaveValue('');
  await page.getByLabel('Saved filter').selectOption({ label: 'New filter' });
  await expect(editor).toHaveValue('draft = false');

  await editor.fill('state =');
  const expressionAlert = page.getByRole('alert');
  await expect(expressionAlert).toContainText(
    "Column 8: Expected a literal, got ''",
  );
  await expect(expressionAlert).not.toContainText('Line');
  await expect(page.getByRole('link', { name: /#1 Fix crash/ })).toBeVisible();
  await page.waitForTimeout(700);

  await page.reload();
  await expect(page.getByText(/Token not configured/)).toBeVisible();
  await expect(editor).toHaveValue('state =');
  await expect(
    page.getByRole('button', { name: 'Remove from top' }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('link', { name: /#1 Fix crash/ })).toBeVisible();

  const refresh = page.getByRole('button', { name: /Refresh/ });
  await expect(refresh).toBeDisabled();
  await page.getByLabel('Personal access token').fill('test-token');
  await page.getByRole('button', { name: 'Validate token' }).click();
  await expect(refresh).toBeEnabled();

  await context.setOffline(true);
  await expect(page.getByText(/Offline · Token in memory/)).toBeVisible();
  await editor.fill('labels ANY ["bug"]');
  await expect(page.getByRole('link', { name: /#1 Fix crash/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /#2 Add feature/ })).toHaveCount(
    0,
  );
});
