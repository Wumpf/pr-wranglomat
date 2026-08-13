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

The app checks `/user` and `/rate_limit`, keeps the PAT in memory only, and requires pasting it again after reload. The app checks `/user` and `/rate_limit`, keeps the PAT in memory only, and requires pasting it again after reload. GitHub login cookies cannot provide silent login to a static site. Organization SSO or approval rules may still block the token.

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

The site is static. Copy `_headers` to a host such as Cloudflare Pages or Netlify for CSP and security headers; `dist/_headers` is emitted by the build. No service worker, analytics, server, or credential persistence is used. Exported filter files contain private filter text; do not publish them.

Language syntax uses field names, quoted strings, numbers, ISO dates, durations (`6h`, `14d`), lists, parentheses, and case-insensitive `AND`, `OR`, `NOT`, `IN`, `NOT IN`, `ANY`, `ALL`, `NONE`, `IS NULL`, `ORDER BY`, and `LIMIT`. GitHub login is not a supported silent authentication mechanism; use a least-privilege PAT.
