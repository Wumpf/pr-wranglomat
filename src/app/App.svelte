<script lang="ts">
  import { onMount } from 'svelte';
  import {
    pullRequestStatus,
    type PullRequestStatus,
    type ReviewState,
  } from '../domain/pullRequest';
  import { createAppState } from './appState.svelte';
  const app = createAppState();
  let repoInput = '';
  let tokenInput = '';
  let message = '';
  let undoFilter: Awaited<ReturnType<typeof app.deleteFilter>>;
  onMount(() => app.init());
  async function add() {
    try {
      await app.addRepository(repoInput);
      repoInput = '';
    } catch (error) {
      message =
        error instanceof Error ? error.message : 'Could not add repository.';
    }
  }
  async function save() {
    await app.saveFilter();
  }
  function chooseFilter(event: Event) {
    void app.selectFilter((event.currentTarget as HTMLSelectElement).value);
  }
  function statusLabel(status: PullRequestStatus): string {
    const labels: Record<PullRequestStatus, string> = {
      open: 'Open',
      draft: 'Draft',
      merged: 'Merged',
      closed: 'Closed',
    };
    return labels[status];
  }
  function reviewStateLabel(
    reviewState: ReviewState | null,
    available: boolean,
  ): string {
    if (!available) return 'Unavailable';
    if (reviewState === 'approved') return 'Approved';
    if (reviewState === 'changes_requested') return 'Changes requested';
    if (reviewState === 'review_required') return 'Review required';
    return 'No decision';
  }
  function relativeTime(value: string): string {
    const seconds = Math.max(
      0,
      Math.floor((Date.now() - new Date(value).valueOf()) / 1000),
    );
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }
</script>

<svelte:head
  ><meta
    name="description"
    content="Local-first GitHub pull request filtering"
  /></svelte:head
>
<div class="shell">
  <header class="topbar">
    <div>
      <h1>PR Wranglomat</h1>
      <p>Local-first pull request triage</p>
    </div>
    <div class="connection" aria-live="polite">
      <span class:ok={app.configured && app.online}>●</span>
      {app.online ? 'Online' : 'Offline'} · {app.configured
        ? 'Token in memory'
        : 'Token not configured'}
      {#if app.authIdentity}
        · {app.authIdentity.login} · {app.authIdentity.rateLimitRemaining} remaining{/if}
    </div>
  </header>
  <main>
    <section class="card credentials" aria-labelledby="credentials-title">
      <h2 id="credentials-title">GitHub access</h2>
      <p class="hint">
        Use a fine-grained, read-only token. It stays in memory and is never
        saved.
      </p>
      <div class="inline">
        <label for="token">Personal access token</label><input
          id="token"
          type="password"
          bind:value={tokenInput}
          autocomplete="off"
          placeholder="github_pat_…"
        /><button
          on:click={async () => {
            try {
              app.setToken(tokenInput);
              tokenInput = '';
              await app.validateToken();
            } catch (e) {
              message = e instanceof Error ? e.message : 'Invalid token';
            }
          }}>Validate token</button
        ><button
          class="secondary"
          disabled={!app.configured}
          on:click={() => app.forgetToken()}>Forget token</button
        >
      </div>
    </section>
    <section class="card repositories" aria-labelledby="repositories-title">
      <div class="section-heading">
        <h2 id="repositories-title">Repositories</h2>
        <span class="badge">{app.repos.length}</span>
      </div>
      <div class="inline">
        <label for="repository">Repository</label><input
          id="repository"
          bind:value={repoInput}
          placeholder="owner/name or GitHub URL"
          on:keydown={(e) => e.key === 'Enter' && add()}
        /><button on:click={add} disabled={app.busy || !app.configured}
          >Add</button
        >
      </div>
      {#if app.repos.length}<div class="repo-list">
          {#each app.repos as repo}<button
              class:selected={app.selected?.id === repo.id}
              class="repo"
              on:click={() => app.select(repo)}
              ><strong>{repo.fullName}</strong><small
                >{repo.visibility} · {repo.lastSyncStatus} · {repo.snapshotCount ??
                  0} PRs{repo.lastSuccessfulSyncAt
                  ? ` · ${relativeTime(repo.lastSuccessfulSyncAt)}`
                  : ''}</small
              ></button
            >{/each}
        </div>{/if}{#if app.selected}<div class="actions">
          <label for="snapshot-scope">Download scope</label>
          <select
            id="snapshot-scope"
            on:change={(event) => {
              const value = (event.currentTarget as HTMLSelectElement).value;
              void app.setSnapshotScope(
                value === 'complete'
                  ? { kind: 'complete' }
                  : value === 'recent'
                    ? {
                        kind: 'recent',
                        cutoffDays: app.recentCutoffDays,
                      }
                    : { kind: 'open' },
              );
            }}
          >
            <option value="open" selected={app.snapshotScope.kind === 'open'}
              >Open PRs (fast)</option
            >
            <option
              value="recent"
              selected={app.snapshotScope.kind === 'recent'}
              >Open + recently closed (90 days)</option
            >
            <option
              value="complete"
              selected={app.snapshotScope.kind === 'complete'}
              >Complete history (slow)</option
            >
          </select>
          {#if app.snapshotScope.kind === 'recent'}
            <label for="recent-cutoff">Closed days</label>
            <input
              id="recent-cutoff"
              type="number"
              min="1"
              max="3650"
              step="1"
              value={app.recentCutoffDays}
              on:change={(event) =>
                void app.setRecentCutoff(
                  Number((event.currentTarget as HTMLInputElement).value),
                )}
            />
          {/if}
          <label for="transport">Transport</label>
          <select
            id="transport"
            on:change={(event) =>
              void app.setTransport(
                (event.currentTarget as HTMLSelectElement).value as
                  'rest' | 'graphql',
              )}
          >
            <option value="rest" selected={app.transport === 'rest'}
              >REST (parallel + cached)</option
            >
            <option value="graphql" selected={app.transport === 'graphql'}
              >GraphQL (smaller responses; no ETag cache)</option
            >
          </select>
          <span>
            {app.selected.fullName}<small class="repo-details">
              {app.selected.visibility} · {app.selected.snapshotCount ?? 0} PRs ·
              completeness {app.selected.snapshotCompleteness?.core
                ? 'core complete'
                : 'not downloaded'} · active snapshot {app.selected
                .historyComplete
                ? 'complete history'
                : app.selected.activeSnapshotScope
                  ? app.selected.activeSnapshotScope.kind === 'recent'
                    ? `recent (${app.selected.activeSnapshotScope.cutoffDays}d)`
                    : 'open only'
                  : 'not downloaded'}
              {#if app.selected.requestCount !== undefined}
                · {app.selected.requestCount} requests{/if}
              {#if app.selected.rateLimitRemaining !== undefined}
                · {app.selected.rateLimitRemaining} remaining{/if}
              {#if app.selected.syncError}
                · {app.selected.syncError}{/if}
            </small>
          </span><button
            on:click={() => app.refresh()}
            disabled={app.busy || !app.configured}>↻ Refresh</button
          >{#if app.busy}<button class="secondary" on:click={() => app.cancel()}
              >Cancel</button
            >{/if}<button
            class="secondary"
            on:click={() => app.removeRepository(app.selected!.id)}
            >Remove repository</button
          ><button
            class="danger"
            on:click={() => app.clearRepositoryData(app.selected!.id)}
            >Delete cached data</button
          ><button class="danger" on:click={() => app.clearData()}
            >Delete all local data</button
          >
        </div>{/if}
      {#if app.historyWarning}<p class="warning" role="status">
          {app.historyWarning}
        </p>{/if}
      <p class="status" aria-live="polite">{app.status}</p>
    </section>
    <section class="card editor" aria-labelledby="filter-title">
      <div class="section-heading">
        <h2 id="filter-title">Filter</h2>
        <div class="filter-actions">
          <select aria-label="Saved filter" on:change={chooseFilter}
            ><option value="">Unsaved filter</option
            >{#each app.filters as filter}<option
                value={filter.id}
                selected={filter.id === app.activeFilter?.id}
                >{filter.name}</option
              >{/each}</select
          ><input
            aria-label="Filter name"
            value={app.activeFilter?.name ?? ''}
            disabled={!app.activeFilter}
            on:input={(e) =>
              app.renameFilter((e.currentTarget as HTMLInputElement).value)}
          /><button
            class="secondary"
            disabled={!app.activeFilter}
            aria-pressed={app.activeFilter?.pinned ?? false}
            title="Pinned filters stay at the top of the saved filter list"
            on:click={() => app.togglePinned()}
            >{app.activeFilter?.pinned
              ? 'Remove from top'
              : 'Keep on top'}</button
          ><button class="secondary" on:click={() => app.newFilter()}
            >New</button
          ><button class="secondary" on:click={() => app.duplicateFilter()}
            >Duplicate</button
          ><button class="secondary" on:click={save}>Save</button><button
            class="secondary"
            on:click={async () => {
              undoFilter = await app.deleteFilter();
            }}
            disabled={!app.activeFilter}>Delete</button
          >{#if undoFilter}<button
              class="secondary"
              on:click={() => {
                void app.restoreFilter(undoFilter);
                undoFilter = undefined;
              }}>Undo</button
            >{/if}
        </div>
      </div>
      <label for="filter-expression">Filter expression</label><textarea
        id="filter-expression"
        rows="5"
        bind:value={app.source}
        spellcheck="false"
        placeholder={'state = "open" AND draft = false\nORDER BY updated_at DESC'}
      ></textarea>{#if app.diagnostics.length}<div
          class="diagnostics"
          role="alert"
        >
          {#each app.diagnostics as diagnostic}<div>⚠ {diagnostic}</div>{/each}
        </div>{/if}
      <p class="help">
        {app.saveState}. {app.diagnosticDetails
          .map((x) => (x.line ? `Line ${x.line}, column ${x.column}` : ''))
          .filter(Boolean)
          .join(' · ')}<br />
        Fields: <code>state</code>, <code>review_state</code>,
        <code>requested_reviewers</code>, <code>requested_teams</code>,
        <code>title</code>, <code>author</code>, <code>labels</code>,
        <code>draft</code>, dates, <code>age</code>. Review states are
        <code>approved</code>, <code>changes_requested</code>, and
        <code>review_required</code> (GraphQL snapshots). GitHub treats a draft
        as <code>state = "open"</code> with <code>draft = true</code>. Operators
        include <code>AND OR NOT IN ANY ALL NONE</code>. {app.result.length} matches{app.unknown
          ? ` · ${app.unknown} unknown`
          : ''}
        {#if app.unavailableFields.length}<br /><strong
            >Unavailable fields:</strong
          >
          {app.unavailableFields.join(', ')}. Results that need these fields may
          be unknown.{/if}
      </p>
    </section>
    <section class="card results" aria-labelledby="results-title">
      <div class="section-heading">
        <h2 id="results-title">Pull requests</h2>
        <span class="badge">{app.result.length}</span>
      </div>
      {#if !app.rows.length}<div class="empty">
          <strong>No snapshot yet</strong>
          <p>
            Add a repository and refresh, or use the filter editor to prepare a
            query.
          </p>
        </div>{:else if !app.result.length}<div class="empty">
          No pull requests match this filter.
        </div>{:else}<div class="table-wrap">
          <table>
            <thead
              ><tr
                ><th scope="col">PR</th><th scope="col">State</th><th
                  scope="col">Review</th
                ><th scope="col">Reviewers</th><th scope="col">Author</th><th
                  scope="col">Labels</th
                ><th scope="col">Updated</th></tr
              ></thead
            ><tbody
              >{#each app.pagedResult as pr}<tr
                  ><td
                    ><a href={pr.url} target="_blank" rel="noreferrer"
                      >#{pr.number} {pr.title}</a
                    ><small>{pr.repo} · {pr.base} ← {pr.head}</small></td
                  ><td
                    ><span class={`state state--${pullRequestStatus(pr)}`}
                      >{statusLabel(pullRequestStatus(pr))}</span
                    ></td
                  ><td
                    ><span
                      class={`review-state review-state--${pr.fieldCompleteness.review_state ? (pr.review_state ?? 'none') : 'unavailable'}`}
                      >{reviewStateLabel(
                        pr.review_state,
                        Boolean(pr.fieldCompleteness.review_state),
                      )}</span
                    ></td
                  ><td class="reviewers"
                    >{#each pr.requested_reviewers as reviewer}<span
                        class="reviewer">@{reviewer}</span
                      >{/each}
                    {#each pr.requested_teams as team}<span class="reviewer"
                        >@{team}</span
                      >{/each}
                    {#if !pr.fieldCompleteness.requested_reviewers || !pr.fieldCompleteness.requested_teams}
                      <span class="reviewer-note">Partial list</span>
                    {:else if !pr.requested_reviewers.length && !pr.requested_teams.length}<span
                        class="muted">—</span
                      >{/if}</td
                  ><td>{pr.author ?? 'Unknown'}</td><td
                    >{#each pr.labels as label}<span class="label">{label}</span
                      >{/each}</td
                  ><td
                    ><time
                      datetime={pr.updated_at}
                      title={new Date(pr.updated_at).toLocaleString()}
                      >{relativeTime(pr.updated_at)}</time
                    ></td
                  ></tr
                >{/each}</tbody
            >
          </table>
        </div>
        {#if app.totalPages > 1}<nav
            class="pagination"
            aria-label="Pull request pages"
          >
            <button
              class="secondary"
              disabled={app.page === 1}
              on:click={() => app.setPage(app.page - 1)}>Previous</button
            >
            <span>Page {app.page} of {app.totalPages}</span>
            <button
              class="secondary"
              disabled={app.page === app.totalPages}
              on:click={() => app.setPage(app.page + 1)}>Next</button
            >
          </nav>{/if}{/if}
    </section>
  </main>
  <footer>
    <p aria-live="polite">{message}</p>
    <p>
      All data stays on this device. <button
        class="link"
        on:click={() => app.forgetToken()}>Forget token</button
      > separately from local data.
    </p>
  </footer>
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }
  :global(body) {
    margin: 0;
    background: #f6f8fa;
    color: #1f2328;
    font:
      14px/1.5 -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      sans-serif;
  }
  :global(button),
  :global(input),
  :global(textarea),
  :global(select) {
    font: inherit;
  }
  :global(button) {
    cursor: pointer;
  }
  .shell {
    min-height: 100vh;
  }
  .topbar {
    padding: 18px max(20px, calc((100% - 1560px) / 2));
    background: #24292f;
    color: white;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .topbar h1 {
    margin: 0;
    font-size: 21px;
  }
  .topbar p {
    margin: 2px 0 0;
    color: #c9d1d9;
  }
  .connection {
    font-size: 13px;
  }
  .connection span {
    color: #8c959f;
  }
  .connection span.ok {
    color: #3fb950;
  }
  main {
    max-width: 1560px;
    margin: 22px auto;
    padding: 0 20px;
    display: grid;
    grid-template-columns: minmax(290px, 340px) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .credentials {
    grid-column: 1;
    grid-row: 1;
  }
  .repositories {
    grid-column: 1;
    grid-row: 2;
  }
  .editor {
    grid-column: 2;
    grid-row: 1;
  }
  .results {
    grid-column: 2;
    grid-row: 2;
  }
  .card {
    background: white;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    padding: 18px;
  }
  .card h2 {
    font-size: 16px;
    margin: 0;
  }
  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .badge {
    background: #ddf4ff;
    border-radius: 20px;
    padding: 2px 9px;
    font-weight: 600;
  }
  .hint,
  .help,
  small {
    color: #57606a;
  }
  .inline {
    display: flex;
    align-items: end;
    gap: 10px;
    flex-wrap: wrap;
  }
  .inline label,
  .editor > label {
    width: 100%;
    font-weight: 600;
    margin-bottom: -5px;
  }
  .inline input {
    flex: 1;
    min-width: 230px;
  }
  .inline input,
  .editor textarea,
  .filter-actions select {
    border: 1px solid #afb8c1;
    border-radius: 6px;
    padding: 7px 9px;
    background: #fff;
  }
  .inline button,
  button {
    border: 1px solid #1f883d;
    background: #1f883d;
    color: #fff;
    border-radius: 6px;
    padding: 7px 13px;
    font-weight: 600;
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  button.secondary,
  .secondary {
    background: #fff;
    color: #1f2328;
    border-color: #afb8c1;
  }
  .danger {
    background: #cf222e;
    border-color: #cf222e;
  }
  .repo-list {
    display: flex;
    gap: 8px;
    margin-top: 14px;
    flex-wrap: wrap;
  }
  .repo {
    background: #fff;
    color: #1f2328;
    text-align: left;
    border-color: #afb8c1;
    display: flex;
    flex-direction: column;
  }
  .repo.selected {
    border-color: #0969da;
    box-shadow: 0 0 0 2px #ddf4ff;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 9px;
    border-top: 1px solid #d8dee4;
    margin-top: 16px;
    padding-top: 14px;
    flex-wrap: wrap;
  }
  .actions span {
    font-weight: 600;
    margin-right: auto;
  }
  .repo-details {
    display: block;
    font-weight: 400;
  }
  .warning {
    margin: 14px 0 0;
    padding: 8px 10px;
    color: #7d4e00;
    background: #fff8c5;
    border: 1px solid #d4a72c;
    border-radius: 6px;
  }
  .status {
    margin: 14px 0 0;
    color: #57606a;
  }
  .filter-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    flex-wrap: wrap;
  }
  .filter-actions select {
    min-width: 190px;
  }
  .filter-actions input {
    min-width: 170px;
  }
  .editor .section-heading {
    align-items: flex-start;
    gap: 20px;
  }
  .editor textarea {
    width: 100%;
    display: block;
    margin-top: 8px;
    resize: vertical;
    font:
      13px/1.6 ui-monospace,
      SFMono-Regular,
      monospace;
  }
  .diagnostics {
    margin-top: 8px;
    padding: 8px 10px;
    background: #ffebe9;
    color: #cf222e;
    border-radius: 6px;
  }
  .help code {
    background: #f6f8fa;
    border: 1px solid #d0d7de;
    border-radius: 3px;
    padding: 1px 4px;
  }
  .empty {
    text-align: center;
    padding: 34px;
    color: #57606a;
  }
  .table-wrap {
    overflow: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    min-width: 1050px;
  }
  th,
  td {
    text-align: left;
    border-top: 1px solid #d8dee4;
    padding: 10px 8px;
    vertical-align: top;
  }
  th {
    color: #57606a;
    font-size: 12px;
  }
  th:first-child,
  td:first-child {
    width: 34%;
    min-width: 260px;
  }
  .reviewers {
    min-width: 150px;
  }
  td a {
    color: #0969da;
    font-weight: 600;
    text-decoration: none;
  }
  td small {
    display: block;
  }
  .state {
    display: inline-block;
    border-radius: 15px;
    padding: 3px 8px;
    font-size: 12px;
    font-weight: 600;
  }
  .state--open {
    color: #1a7f37;
    background: #dafbe1;
  }
  .state--draft {
    color: #57606a;
    background: #eaeef2;
  }
  .state--merged {
    color: #8250df;
    background: #fbefff;
  }
  .state--closed {
    color: #cf222e;
    background: #ffebe9;
  }
  .review-state {
    display: inline-block;
    border-radius: 15px;
    padding: 3px 8px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }
  .review-state--approved {
    color: #1a7f37;
    background: #dafbe1;
  }
  .review-state--changes_requested {
    color: #9a6700;
    background: #fff8c5;
  }
  .review-state--review_required {
    color: #0969da;
    background: #ddf4ff;
  }
  .review-state--none,
  .review-state--unavailable,
  .muted {
    color: #8c959f;
  }
  .reviewer {
    display: block;
    color: #0969da;
    white-space: nowrap;
  }
  .reviewer-note {
    display: block;
    color: #9a6700;
    font-size: 12px;
    white-space: nowrap;
  }
  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-top: 14px;
  }
  .label {
    display: inline-block;
    background: #ddf4ff;
    color: #0969da;
    border-radius: 12px;
    padding: 2px 7px;
    margin: 0 3px 3px 0;
    font-size: 12px;
  }
  footer {
    max-width: 1560px;
    padding: 0 20px 25px;
    margin: auto;
    color: #57606a;
  }
  .link {
    border: 0;
    padding: 0;
    color: #0969da;
    background: transparent;
    font-weight: 400;
  }
  :global(button:focus-visible),
  :global(input:focus-visible),
  :global(textarea:focus-visible),
  :global(select:focus-visible),
  :global(a:focus-visible) {
    outline: 3px solid #0969da;
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    :global(*) {
      scroll-behavior: auto !important;
      transition: none !important;
    }
  }
  @media (max-width: 1050px) {
    main {
      grid-template-columns: minmax(0, 1fr);
    }
    .credentials,
    .repositories,
    .editor,
    .results {
      grid-column: 1;
      grid-row: auto;
    }
    .credentials {
      order: 1;
    }
    .repositories {
      order: 2;
    }
    .editor {
      order: 3;
    }
    .results {
      order: 4;
    }
  }
  @media (max-width: 700px) {
    .topbar {
      align-items: flex-start;
      gap: 10px;
      flex-direction: column;
    }
    .editor .section-heading {
      align-items: stretch;
      flex-direction: column;
    }
    .filter-actions {
      justify-content: flex-start;
      margin-top: 10px;
    }
    .filter-actions select,
    .filter-actions input {
      flex: 1 1 100%;
    }
    .card {
      padding: 14px;
    }
  }
</style>
