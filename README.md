# PR Wranglomat

A static, local-first pull request filter. GitHub metadata is downloaded directly to your browser and stored in IndexedDB. The personal access token is held in memory only and is never stored, exported, or logged.

## Run locally

Prerequisites:

- Node.js 22 or later
- npm

From the repository directory, install dependencies and start the development server:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite, usually <http://localhost:5173>.

To run a production build locally:

```sh
npm run build
npm run preview
```

Open the preview URL printed by Vite, usually <http://localhost:4173>. The static files are written to `dist/`.

### Connect to GitHub

1. In GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Create a token restricted to the repositories you need.
3. Grant read-only **Metadata** and **Pull requests** access.
4. In PR Wranglomat, paste the token and select **Validate token**.
5. Add a repository as `owner/name` or a GitHub URL, then select **Refresh**.

The app checks `/user` and `/rate_limit`, keeps the PAT in memory only, and requires pasting it again after reload. GitHub login cookies cannot provide silent login to a static site. Organization SSO or approval rules may still block the token.

Private repository metadata remains in this browser's IndexedDB until you explicitly delete it. **Forget token** only removes the in-memory credential. **Delete cached data** removes one repository's snapshot, **Remove repository** removes that repository and its cache, and **Delete all local data** clears every local filter, setting, repository, and snapshot.

## Development checks

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

To run browser tests, install Playwright's Chromium build once:

```sh
npx playwright install chromium
npm run test:e2e
```

## Filter example

```text
state IN ["open", "merged"] AND draft = false AND age > 14d ORDER BY updated_at ASC LIMIT 200
```

The site is static. Copy `_headers` to a host such as Cloudflare Pages or Netlify for CSP and security headers; `dist/_headers` is emitted by the build. No service worker, analytics, server, or credential persistence is used.

Refresh defaults to **Open PRs**, which is much faster than downloading a full history. You can choose **Open + recently closed** with a configurable 1–3,650 day cutoff (90 days by default), or **Complete history**. Incomplete scopes show a warning: no-match results do not prove that omitted historical PRs are absent. REST refreshes up to four pages in parallel and stores normalized page data with ETags for later conditional requests. GraphQL is optional and requests smaller responses with cursor pagination, but does not use the REST ETag cache. It also provides `review_state` values (`approved`, `changes_requested`, and `review_required`) and `reviewed_by`, the distinct GitHub users who submitted reviews. REST snapshots mark these fields as unavailable. Tokens and raw GitHub responses are never cached.

Language syntax uses field names, quoted strings, numbers, ISO dates, durations (`6h`, `14d`), lists, parentheses, and case-insensitive `AND`, `OR`, `NOT`, `IN`, `NOT IN`, `ANY`, `ALL`, `NONE`, `IS NULL`, `IS EMPTY`, `ORDER BY`, and `LIMIT`. Use `requested_reviewers IS EMPTY AND requested_teams IS EMPTY` to find pull requests without pending reviewer or team requests. Use `reviewed_by ANY ["alice"]` to find reviews submitted by a user. The data model follows GitHub's API: a draft pull request has `state = "open"` and `draft = true`, while the results table shows its GitHub-style status as **Draft**. GitHub login is not a supported silent authentication mechanism; use a least-privilege PAT.
