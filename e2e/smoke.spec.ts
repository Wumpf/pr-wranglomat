import { test, expect, type Page } from '@playwright/test';

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
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Authorization, Accept, Content-Type',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const url = new URL(request.url());
    expect(request.headers().authorization).toBe('Bearer test-token');
    expect(url.pathname).toBe('/graphql');
    expect(request.method()).toBe('POST');
    const { query, variables } = request.postDataJSON();
    if (query.includes('query Viewer')) {
      await route.fulfill({
        headers: cors,
        json: {
          data: {
            viewer: { login: 'octocat' },
            rateLimit: { remaining: 4998, resetAt: '2030-01-01T00:00:00Z' },
          },
        },
      });
      return;
    }
    if (query.includes('query Repo(')) {
      await route.fulfill({
        headers: cors,
        json: {
          data: {
            repository: {
              databaseId: 7,
              nameWithOwner: 'acme/app',
              visibility: 'PRIVATE',
              defaultBranchRef: { name: 'main' },
            },
          },
        },
      });
      return;
    }
    if (query.includes('query PullRequests')) {
      expect(request.postData()).toContain('reviewDecision');
      expect(request.postData()).toContain('reviews(first:100');
      await route.fulfill({
        headers: cors,
        json: {
          data: {
            repository: {
              pullRequests: {
                nodes: variables.cursor
                  ? [graphPullRequest(2, 'Add feature', 'APPROVED', true)]
                  : [graphPullRequest(1, 'Fix crash', 'REVIEW_REQUIRED')],
                pageInfo: {
                  hasNextPage: !variables.cursor,
                  endCursor: variables.cursor ? null : 'next-page',
                },
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
  await expect(
    page
      .locator('.results tbody tr')
      .first()
      .locator('td')
      .nth(5)
      .locator('.reviewer'),
  ).toHaveText('@alice');
  await expect(page.getByRole('button', { name: 'Export' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Import' })).toHaveCount(0);
  await expect(page.getByText(/2 PRs/).first()).toBeVisible();
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
  await expect(
    page.getByLabel('Saved filter').locator('option:checked'),
  ).toHaveText('My filter');
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
  await expect(
    page.getByText('Download preferences saved for selected repositories.'),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Download scope')).toHaveValue('recent');
  await expect(page.getByLabel('Closed days')).toHaveValue('120');
  await expect(historyWarning).toBeVisible();

  await page.getByRole('button', { name: 'New filter', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Create filter' }),
  ).toBeVisible();
  await expect(page.getByLabel('Filter name')).toHaveValue('New filter');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.getByLabel('Saved filter').locator('option:checked'),
  ).toHaveText('New filter');
  const editor = page.getByLabel('Filter expression');
  await editor.fill('state = "open"');
  await expect(page.getByText(/^Saved\./)).toBeVisible({ timeout: 2_000 });

  await editor.fill('draft = false');
  await page.getByLabel('Saved filter').selectOption({ label: 'My filter' });
  await expect(editor).toHaveValue('');
  await page.getByLabel('Saved filter').selectOption({ label: 'New filter' });
  await expect(editor).toHaveValue('draft = false');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const renameDialog = page.getByRole('dialog', { name: 'Rename filter' });
  await renameDialog.getByLabel('Filter name').fill('Review queue');
  await renameDialog.getByRole('button', { name: 'Rename' }).click();
  await expect(
    page.getByLabel('Saved filter').locator('option:checked'),
  ).toHaveText('Review queue');

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
