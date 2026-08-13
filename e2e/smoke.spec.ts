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

async function mockGitHub(page: Page) {
  await page.route('https://api.github.com/**', async (route) => {
    const request = route.request();
    const cors = {
      'access-control-allow-origin': 'http://127.0.0.1:4173',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Authorization, Accept',
      'access-control-expose-headers': 'Link, X-RateLimit-Remaining',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const url = new URL(request.url());
    expect(request.headers().authorization).toBe('Bearer test-token');
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
            ? [pullRequest(2, 'Add feature', ['feature'])]
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
  await expect(page.getByText(/2 PRs/).first()).toBeVisible();
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

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByLabel('Filter name')).toHaveValue('New filter');
  const editor = page.getByLabel('Filter expression');
  await editor.fill('state = "open"');
  await expect(page.getByText(/^Saving\./)).toBeVisible();
  await expect(page.getByText(/^Saved\./)).toBeVisible({ timeout: 2_000 });
  await editor.fill('state =');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('link', { name: /#1 Fix crash/ })).toBeVisible();
  await page.waitForTimeout(700);

  await page.reload();
  await expect(page.getByText(/Token not configured/)).toBeVisible();
  await expect(editor).toHaveValue('state =');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('link', { name: /#1 Fix crash/ })).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText(/Offline · Token not configured/)).toBeVisible();
  await editor.fill('labels ANY ["bug"]');
  await expect(page.getByRole('link', { name: /#1 Fix crash/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /#2 Add feature/ })).toHaveCount(
    0,
  );
});
