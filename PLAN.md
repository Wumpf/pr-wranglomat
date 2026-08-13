# PR Wranglomat implementation plan

## Short synopsis

Build a static, local-first Svelte 5 application. A user adds a GitHub repository, supplies a least-privilege fine-grained personal access token (PAT), and presses **Refresh**. The browser downloads pull-request metadata directly from GitHub into IndexedDB. Named text filters, the active filter, and repository snapshots also live in IndexedDB, so filtering works offline and nothing is stored by the host.

The filter language is a small, typed expression language rather than GitHub search syntax. It supports parentheses, boolean logic, comparisons, lists, collection operators, dates, durations, sorting, and clear parse errors. A GitHub-like PR list evaluates the filter against normalized local records.

A static site cannot silently reuse a visitor's `github.com` login cookie. For the MVP, use a PAT held in memory only. Later, offer either a `gh`-based local companion or JSON snapshot importer for safer private-repository use. Treat browser-only OAuth device flow as experimental until GitHub documents or an end-to-end test proves CORS support for its OAuth endpoints.

## Product goals

1. Add one or more repositories by `owner/name` or GitHub URL.
2. Download all PR list metadata and refresh it on demand.
3. Run expressive filters entirely in the browser, including while offline.
4. Create, name, duplicate, rename, delete, switch, and auto-save filters.
5. Present results in a familiar GitHub-like PR list.
6. Keep hosted assets static and store no user data on the host.
7. Support private repositories without embedding a shared secret in the app.
8. Make stale, partial, unavailable, and not-yet-downloaded data explicit.

## Non-goals for the MVP

- Server-side accounts, sync, scheduled refreshes, or filter storage.
- Silent GitHub single sign-on.
- Full issue search, code search, or cross-repository GitHub Search API emulation.
- PR bodies, comments, changed files, checks, timeline events, or complete review history.
- GitHub Enterprise Server.
- Mobile-first layout or exact pixel parity with GitHub.
- Running model-generated code. Models may generate filter text only.

## Four feasible solution shapes

### A. Static browser app with a fine-grained PAT — recommended MVP

The user creates a fine-grained PAT restricted to selected repositories and the minimum read permission. The browser sends it only to `https://api.github.com` and keeps it in memory.

**Advantages**

- Fully static deployment.
- Direct support for private repositories.
- Smallest implementation that supports refresh.
- GitHub documents API CORS and endpoint permissions.

**Costs and risks**

- Setup is less friendly than a Sign in button.
- Reloading the page requires pasting the token again.
- XSS, a compromised dependency, or a malicious extension can steal an unlocked token.
- Organization SSO and token-approval rules can still block access.

**Decision:** implement this first. Do not persist the token in localStorage, sessionStorage, IndexedDB, URLs, exports, logs, analytics, or service-worker caches.

### B. Browser-only OAuth device flow — possible, but experimental

A registered OAuth App can use a public client ID and device flow does not require a client secret. The user opens GitHub, enters a code, and approves access. An existing GitHub login makes that authorization page easier, but authorization is still explicit.

**Blocking uncertainty:** GitHub documents CORS for its REST and GraphQL API endpoints, but not for `github.com/login/device/code` and `github.com/login/oauth/access_token`. A static browser implementation must not depend on this flow until a real-browser test from the production origin passes and policy support is confirmed.

**Decision:** place this behind a later technical spike. Keep PAT support even if device flow works.

### C. Static UI plus an optional local `gh` companion — preferred later private-repo path

A small local process uses the existing `gh auth` credential and gives the static UI normalized PR data. The website never sees the GitHub token.

**Advantages**

- Closest safe equivalent to “just use my existing GitHub login.”
- Reuses `gh` credential storage and organization authentication.
- Can perform richer or long-running downloads without exposing credentials to site JavaScript.

**Costs and risks**

- Requires installation and a running localhost process.
- The companion must bind only to loopback, check `Origin`, use a random per-session capability, and never interpolate filter text into a shell command.
- Packaging and cross-platform support add work.

**Decision:** design an ingestion interface now so this can be added later, but do not include it in the MVP.

### D. Offline snapshot generator and import

A command such as `pr-wranglomat-export owner/repo > snapshot.json` uses `gh` locally. The static page imports and filters that file without any credential.

**Advantages**

- Smallest hosted attack surface.
- Simple to audit and useful in locked-down environments.
- No browser OAuth or API CORS dependency.

**Costs and risks**

- Manual and stale by design.
- Snapshot files can contain private metadata and must never be published by mistake.
- Less convenient than a Refresh button.

**Decision:** add versioned import/export after the core browser refresh works. The same schema can support the future local companion.

### Why normal OAuth and GitHub Apps do not solve this in a static site

A static site cannot keep an OAuth client secret or GitHub App private key secret. Normal OAuth web flow needs a trusted token-exchange component, and GitHub App installation tokens require server-side signing. A tiny stateless OAuth relay is a valid future option, but it makes the system more than a static website even if it stores no user data.

## Recommended technology stack

Keep the runtime small and avoid a backend:

- **Language/build:** Svelte 5, TypeScript, and Vite. Use a plain Vite SPA rather than SvelteKit; the MVP needs neither server routes nor server rendering.
- **UI:** Svelte components, semantic HTML, component-scoped CSS, Primer design tokens, and Octicons. Use Svelte runes and small `.svelte.ts` state modules rather than a separate state-management library.
- **Local database:** Dexie over IndexedDB. Expose database changes through small Svelte-aware repository/state modules; keep Dexie and domain logic framework-independent.
- **GitHub access:** native `fetch` behind a small typed `GitHubClient`; start with REST.
- **Filtering:** a custom lexer, recursive-descent parser, type checker, formatter, and AST evaluator. Never use `eval` or `new Function`.
- **Background work:** a Web Worker for filter evaluation once snapshot sizes justify it. Keep the pure evaluator runnable without a worker for tests.
- **Unit/component tests:** Vitest, Svelte Testing Library, `fake-indexeddb`, and MSW.
- **Browser tests:** Playwright.
- **Deployment:** static output for GitHub Pages, Cloudflare Pages, Netlify, or any file host.

Start the filter editor as a normal `<textarea>` with inline diagnostics. Add CodeMirror only after the language and UX are stable.

## Architecture

Use these boundaries:

```text
GitHub REST / imported snapshot / future local companion
                         |
                         v
                  ingestion adapters
                         |
                         v
             normalized versioned snapshot
                         |
                    IndexedDB
                         |
             query parser and evaluator
                         |
                GitHub-like Svelte UI
```

Suggested source layout:

```text
src/
  app/
    App.svelte
    appState.svelte.ts
  domain/
    pullRequest.ts
    repository.ts
    snapshot.ts
    normalize.ts
  github/
    auth.ts
    client.ts
    errors.ts
    restPullRequests.ts
    sync.ts
  ingestion/
    source.ts
    githubSource.ts
    snapshotFileSource.ts
  query/
    ast.ts
    fields.ts
    lexer.ts
    parser.ts
    typecheck.ts
    evaluate.ts
    format.ts
  storage/
    db.ts
    migrations.ts
    repositories.ts
    snapshots.ts
    filters.ts
    settings.ts
  features/
    auth/
    repositories/
    filters/
    pullRequests/
    refresh/
  workers/
    filter.worker.ts
  test/
    fixtures/
    setup.ts
```

Core interfaces:

```ts
interface PullRequestSource {
  resolveRepository(
    input: string,
    credential?: Credential,
  ): Promise<Repository>;
  createSnapshot(
    repository: Repository,
    options: SnapshotOptions,
    onProgress: (progress: SyncProgress) => void,
    signal: AbortSignal,
  ): Promise<SnapshotResult>;
}

interface CompiledFilter {
  ast: QueryAst;
  requiredFields: Set<PullRequestField>;
  sort: SortClause[];
  limit?: number;
}
```

The UI, storage layer, and query engine must not depend on raw GitHub response shapes.

## Authentication and privacy design

### What is and is not possible

An arbitrary static origin cannot read GitHub's `HttpOnly` login cookies or convert a GitHub website session into an API credential. GitHub API access to private data requires an explicit token or a trusted local/server component. Existing GitHub login may reduce prompts during OAuth or device authorization, but it cannot provide silent access.

### MVP token flow

1. Show a short fine-grained PAT setup guide.
2. Ask the user to paste a token.
3. Keep it in a module-owned in-memory credential store.
4. Validate it with a small API request and show the authenticated login and rate limit.
5. Send it only in the `Authorization` header to the configured GitHub API origin.
6. Provide **Forget token**. Forgetting the token does not silently delete snapshots.
7. Provide a separate **Delete private local data** and **Delete all local data** action.
8. On reload, cached filters and snapshots remain but the token does not.

The application must explain that private PR metadata remains in browser storage until deleted. “Sign out,” “forget credential,” and “delete cached data” are separate operations.

### Security controls

- No analytics or third-party script tags in authenticated pages.
- Pin dependencies and keep the dependency count low.
- Render GitHub text as text. Do not render raw HTML. Sanitize any future Markdown.
- Ship a strict Content Security Policy. Include a meta policy for hosts without custom headers and a `_headers` example for hosts that support headers.
- Restrict `connect-src` to GitHub API origins selected by the product.
- Never log request headers, token-bearing errors, raw imported files, or private response bodies.
- Do not register a service worker in the MVP.
- Document that client-side encryption without a user-held secret does not protect a stored token from XSS.

## GitHub ingestion plan

### MVP field set

Only expose fields that can be populated reliably by the selected ingestion profile:

- Repository ID and full name.
- PR number and URL.
- Title.
- State: `open`, `closed`, or `merged` (derive `merged` only from an explicit merged timestamp/flag).
- Draft status.
- Author.
- Labels.
- Assignees.
- Requested reviewers and requested teams when returned by the endpoint.
- Head and base branch names.
- Milestone.
- Created, updated, closed, and merged timestamps.
- Data provenance: source, fetched time, snapshot ID, and completeness flags.

Do not store PR bodies by default. They increase storage, private-data exposure, and rendering risk.

### Refresh algorithm

1. Resolve and validate `owner/name`.
2. Start a new snapshot generation with status `building`.
3. Request `GET /repos/{owner}/{repo}/pulls?state=all&per_page=100`, follow documented pagination links, and use bounded retries with jitter.
4. Normalize and deduplicate every page. Store pages under the new snapshot generation.
5. Display pages, request count, remaining rate limit, cancellation, and errors.
6. Only after every page succeeds, atomically set the repository's `activeSnapshotId` to the new generation.
7. Delete the old generation after the switch. A failed or cancelled refresh leaves the prior active snapshot untouched and deletes the incomplete generation.
8. Preserve explicit `partial`, `forbidden`, `rate-limited`, and `stale` statuses. Never interpret unavailable fields as empty values.

Use a maximum concurrency of one for list pagination. Add enrichment requests only as an explicit later profile because per-PR requests can exhaust limits quickly. Respect `Retry-After`, primary rate-limit headers, secondary limits, and `AbortController` cancellation.

### Later ingestion profiles

- **Core:** the MVP list-level fields.
- **Reviews:** review requests, reviews, and a documented review-decision source.
- **Changes:** additions, deletions, changed-file count, and optionally filenames.
- **Checks:** latest commit and check-rollup summary.

Each snapshot records which profile and fields are complete. A filter that requires unavailable data gets a visible warning and an `unknown` result, not a false match. Consider GraphQL only after measuring REST request cost and defining nested-pagination behavior.

Do not use GitHub Search as the ingestion source; its result cap makes it unsuitable for complete repository snapshots.

## IndexedDB schema

Database: `pr-wranglomat`, schema version `1`.

### `repositories`

Key: GitHub repository ID.

```ts
{
  id: number;
  fullName: string;
  visibility: "public" | "private" | "internal";
  defaultBranch: string;
  activeSnapshotId?: string;
  lastSuccessfulSyncAt?: string;
  lastSyncStatus: SyncStatus;
}
```

Indexes: `fullName`, `lastSuccessfulSyncAt`.

### `pullRequests`

Compound key: `[repositoryId, snapshotId, number]`.

Store normalized filterable fields plus `fieldCompleteness`, `sourceUpdatedAt`, and `fetchedAt`. Index by `[repositoryId+snapshotId]`; add more indexes only after profiling because filtering happens against the active in-memory snapshot.

### `snapshots`

Key: snapshot UUID. Store repository ID, state, schema version, ingestion profile, completeness, counts, start/finish time, source, and non-secret failure metadata.

### `filters`

```ts
{
  id: string;
  name: string;
  nameKey: string;
  source: string;
  lastValidAst?: QueryAst;
  languageVersion: 1;
  repositoryScope: "all" | number[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}
```

Enforce unique trimmed, case-folded `nameKey` in a transaction. Preserve invalid draft text and the last valid AST separately so a typo does not destroy a working filter.

### `settings`

Key/value records for active filter, selected repositories, display density, and other non-secret preferences. Store no credential.

### Storage behavior

- Use forward-only, transactional migrations.
- Handle blocked upgrades, quota errors, private-browsing limitations, and multi-tab `versionchange` events.
- Use `BroadcastChannel` to notify other tabs about filter and snapshot changes.
- Add versioned filter export/import. Add snapshot export/import later.
- Never clear the database automatically after a migration or parse failure.

Cookies are not suitable: they are small, sent to the host, and awkward to version. IndexedDB is the correct store for snapshots and named filters.

## Filter language version 1

### Example

```text
state IN ["open", "merged"]
AND draft = false
AND (labels ANY ["bug", "regression"] OR title CONTAINS "crash")
AND author NOT IN ["dependabot[bot]", "renovate[bot]"]
AND age > 14d
ORDER BY updated_at ASC, number DESC
LIMIT 200
```

### Grammar and semantics

- Literals: quoted strings, numbers, booleans, `null`, ISO dates, durations such as `6h`, `14d`, and lists.
- Boolean operators: `NOT`, `AND`, `OR` with that precedence; parentheses override precedence.
- Scalar comparisons: `=`, `!=`, `<`, `<=`, `>`, `>=`, `IN`, `NOT IN`.
- Text comparisons: `CONTAINS`, `STARTS WITH`, and `ENDS WITH`, case-insensitive by default.
- Collection comparisons: `ANY`, `ALL`, and `NONE` against a list.
- Missing values: `IS NULL` and `IS NOT NULL`.
- Optional trailing clauses: `ORDER BY field ASC|DESC` and `LIMIT integer`.
- Field names and keywords are case-insensitive. The formatter emits canonical lower-case fields and upper-case keywords.
- `age` means `evaluationTime - updated_at`. The evaluator receives a fixed clock so one run is deterministic.
- Unknown fields, wrong literal types, unsupported operators, malformed dates, and unavailable fields produce source-spanned diagnostics.
- Use three-valued internal logic: `true`, `false`, and `unknown`. Only `true` rows match. The UI reports how many rows were unknown because required data was unavailable.
- No arbitrary property access, functions, JavaScript, regular expressions, or unbounded recursion in version 1.

Initial fields:

```text
repo, number, url, title, state, draft, author,
labels, assignees, requested_reviewers, requested_teams,
base, head, milestone,
created_at, updated_at, closed_at, merged_at, age
```

The compiler returns the required field set before evaluation. Use this to warn about incomplete snapshots.

### Saved-filter behavior

- A user explicitly creates the first named filter.
- Subsequent name and source edits auto-save after 600 ms.
- Show `Saved`, `Saving`, `Invalid draft`, or `Storage error`.
- Invalid text persists as a draft, but results continue to use the last valid AST and are clearly marked.
- Support rename, duplicate, delete with undo, pin, and switch.
- Keep active filter and repository scope after reload.
- Provide JSON export/import for filter definitions. Validate version, size, duplicate names, and syntax before writing.

## User interface

Use a dense GitHub-like shell, not an exact clone:

1. **Header:** product name, repository selector, local/offline state, credential status, and settings.
2. **Repository panel:** add repository, visibility, PR count, last refresh, stale/error badge, Refresh, Cancel, Remove, and Delete data.
3. **Filter bar:** named-filter switcher plus New, Duplicate, Rename, Delete, Import, and Export.
4. **Filter editor:** text area, inline errors with line/column, supported-field help, result/unknown count, and save state.
5. **PR list:** state icon, title, repo and PR number, author, labels, draft marker, requested review summary, branches, and relative update age. Every row links to GitHub.
6. **States:** first-run, loading, refreshing with old results still visible, empty snapshot, no matches, stale, offline, unauthorized, forbidden, rate-limited, cancelled, quota failure, and invalid filter.

Use real buttons, labels, focus states, keyboard navigation, visible focus, non-color status cues, reduced-motion support, and sufficient contrast. Start with pagination; add list virtualization only if profiling shows it is needed.

## Implementation phases

### Phase 0: scaffold and contracts

- Create the Vite Svelte 5 TypeScript application without SvelteKit.
- Configure linting, formatting, Vitest, Svelte Testing Library, MSW, and Playwright.
- Add static-host build and a strict CSP baseline.
- Define normalized domain, ingestion, snapshot, and typed-error contracts.
- Add synthetic fixtures; never commit real private-repository data.

**Exit criteria:** build, unit tests, and one browser smoke test pass in CI.

### Phase 1: query engine

- Specify language-v1 tokens and grammar in code and user documentation.
- Implement lexer, parser, AST, type checker, formatter, and pure evaluator.
- Add deterministic clock and three-valued missing-data semantics.
- Add source-spanned diagnostics and required-field extraction.
- Cover precedence, escaping, lists, dates, durations, all operators, invalid syntax, type errors, depth/size limits, sorting, and limits.

**Exit criteria:** fixture records produce stable, tested results; no dynamic code execution exists.

### Phase 2: local persistence

- Implement Dexie schema and repository classes.
- Implement repository, staged snapshot, active-snapshot switch, filters, and settings.
- Add filter auto-save, invalid-draft preservation, multi-tab notifications, and migration tests.
- Add filter export/import and complete local-data deletion.

**Exit criteria:** named filters and active snapshots survive reload; a failed staged refresh cannot replace the last good snapshot.

### Phase 3: GitHub authentication and refresh

- Implement the memory-only credential store and PAT guidance.
- Implement repository resolution and REST pagination through `PullRequestSource`.
- Normalize responses and store staged pages.
- Implement progress, cancellation, retries, rate-limit display, and typed errors.
- Test with MSW fixtures for public, private, renamed, forbidden, rate-limited, paginated, cancelled, and malformed responses.

**Exit criteria:** a public and an authorized private test repository can be fully refreshed without persisting the credential.

### Phase 4: application UI

- Build first-run, repository manager, refresh status, filter manager/editor, and PR list.
- Add GitHub-like visual tokens and Octicons.
- Add stale, offline, unknown-field, invalid-filter, and empty states.
- Add responsive keyboard-accessible interactions and deep links.

**Exit criteria:** the complete add → authenticate → refresh → create filter → reload → filter offline flow passes in Playwright.

### Phase 5: hardening and deployment

- Test with at least 10,000 synthetic PRs and move evaluation to a Web Worker if the main thread exceeds the target.
- Audit CSP, dependency graph, token leakage, logs, exports, URLs, and error surfaces.
- Add static deployment documentation and host-specific security-header examples.
- Test browser quota failure, IndexedDB denial, multi-tab upgrades, network interruption, and clear-data flows.

**Exit criteria:** filtering 10,000 core records completes in under 200 ms on the agreed reference machine without a visible UI freeze; security and accessibility checks pass.

### Phase 6: post-MVP options

Implement in this order unless user feedback says otherwise:

1. Versioned snapshot import/export.
2. Optional `gh` snapshot generator.
3. Local `gh` companion with loopback security.
4. Review/change/check enrichment profiles.
5. Filter autocomplete and syntax highlighting.
6. Browser device-flow spike, only with confirmed OAuth-endpoint CORS and a documented fallback.
7. Multiple GitHub hosts/GitHub Enterprise Server.

## Acceptance checklist

The implementation is ready for its first release when:

- [ ] It deploys as static files with no application server.
- [ ] No token is present in persistent storage, URLs, exports, logs, fixtures, or built assets.
- [ ] Private repository refresh works with a least-privilege user token.
- [ ] A failed or cancelled refresh preserves the previous complete snapshot.
- [ ] Named filters auto-save and survive reload.
- [ ] Invalid drafts survive reload without replacing the last working compiled filter.
- [ ] The language supports nested boolean logic, comparisons, lists, collection tests, dates/durations, sorting, and limits.
- [ ] Missing or unavailable data is distinguishable from an empty value.
- [ ] Cached filtering works offline.
- [ ] The UI shows snapshot age, completeness, rate limit, and refresh status.
- [ ] Filter import rejects unsupported versions, invalid syntax, and excessive files without losing existing data.
- [ ] Core parser, evaluator, migration, sync, security, accessibility, and end-to-end flows have automated tests.
- [ ] The final documentation explains PAT setup, local private-data retention, deletion, and the limits of GitHub-login reuse.

## Decisions the product owner can defer, but should revisit

1. Whether review decisions, checks, changed files, and comments are release requirements. They materially increase ingestion cost.
2. Whether re-pasting a token after reload is acceptable. If not, prefer the local `gh` companion over unprotected browser persistence.
3. Expected maximum repository size and target refresh time.
4. Whether filters should span several repositories in the first release. The schema supports this; the UI can initially select one repository.
5. Whether GitHub Enterprise Server support is required.
6. Whether imported private snapshots may be exported again and what warnings that requires.

## Primary GitHub references

- [Authenticating to the REST API](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api)
- [Using CORS with the REST API](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests)
- [Managing personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [List pull requests](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests)
- [REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [OAuth web and device flows](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Generating a GitHub App installation token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token)
