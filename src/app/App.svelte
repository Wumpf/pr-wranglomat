<script lang="ts">
  import { onMount } from 'svelte';
  import { createAppState } from './appState.svelte';
  const app = createAppState();
  let repoInput = '';
  let tokenInput = '';
  let message = '';
  let undoFilter: Awaited<ReturnType<typeof app.deleteFilter>>;
  let importInput: HTMLInputElement;
  onMount(() => app.init());
  function download(name: string, content: string) {
    const url = URL.createObjectURL(
      new Blob([content], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }
  function exportFilters() {
    download('pr-wranglomat-filters.json', app.exportFilters());
  }
  async function importFilters(file: File) {
    try {
      await app.importFilters(await file.text());
      message = 'Filters imported.';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Import failed.';
    }
  }
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
    <section class="card" aria-labelledby="repositories-title">
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
          <span>
            {app.selected.fullName}<small class="repo-details">
              {app.selected.visibility} · {app.selected.snapshotCount ?? 0} PRs ·
              completeness {app.selected.snapshotCompleteness?.core
                ? 'core complete'
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
            on:click={() => app.togglePinned()}
            >{app.activeFilter?.pinned ? 'Unpin' : 'Pin'}</button
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
          ><button class="secondary" on:click={exportFilters}>Export</button
          ><button class="secondary" on:click={() => importInput.click()}
            >Import</button
          ><input
            bind:this={importInput}
            type="file"
            accept="application/json"
            hidden
            on:change={(e) => {
              const file = (e.currentTarget as HTMLInputElement).files?.[0];
              if (file) void importFilters(file);
            }}
          />{#if undoFilter}<button
              class="secondary"
              on:click={() => {
                void app.restoreFilter(undoFilter);
                undoFilter = undefined;
              }}>Undo</button
            >{/if}
          >
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
        Fields: <code>state</code>, <code>title</code>, <code>author</code>,
        <code>labels</code>, <code>draft</code>, dates, <code>age</code>.
        Operators include <code>AND OR NOT IN ANY ALL NONE</code>. {app.result
          .length} matches{app.unknown ? ` · ${app.unknown} unknown` : ''}
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
                  scope="col">Author</th
                ><th scope="col">Labels</th><th scope="col">Updated</th></tr
              ></thead
            ><tbody
              >{#each app.pagedResult as pr}<tr
                  ><td
                    ><a href={pr.url} target="_blank" rel="noreferrer"
                      >#{pr.number} {pr.title}</a
                    ><small
                      >{pr.repo} · {pr.base} ← {pr.head}{pr.draft
                        ? ' · Draft'
                        : ''}{pr.requested_reviewers.length ||
                      pr.requested_teams.length
                        ? ` · Review requested: ${[...pr.requested_reviewers, ...pr.requested_teams.map((team) => `team:${team}`)].join(', ')}`
                        : ''}</small
                    ></td
                  ><td><span class="state">{pr.state}</span></td><td
                    >{pr.author ?? 'Unknown'}</td
                  ><td
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
    padding: 18px max(20px, calc((100% - 1180px) / 2));
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
    max-width: 1180px;
    margin: 22px auto;
    padding: 0 20px;
    display: grid;
    gap: 16px;
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
  .status {
    margin: 14px 0 0;
    color: #57606a;
  }
  .filter-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
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
    min-width: 700px;
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
  td:first-child {
    max-width: 450px;
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
    font-size: 12px;
    color: #1a7f37;
    background: #dafbe1;
    border-radius: 15px;
    padding: 3px 8px;
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
    max-width: 1180px;
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
  @media (max-width: 700px) {
    .topbar {
      align-items: flex-start;
      gap: 10px;
      flex-direction: column;
    }
    .filter-actions {
      margin-top: 10px;
    }
    .card {
      padding: 14px;
    }
  }
</style>
