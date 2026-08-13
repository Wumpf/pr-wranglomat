import type { PullRequest } from './pullRequest';
export interface GitHubPullRequest {
  number: number;
  html_url: string;
  title: string;
  state: 'open' | 'closed';
  draft?: boolean;
  user?: { login: string } | null;
  labels?: Array<{ name: string }>;
  assignees?: Array<{ login: string }>;
  requested_reviewers?: Array<{ login: string }>;
  requested_teams?: Array<{ name: string }>;
  base: { ref: string };
  head: { ref: string };
  milestone?: { title: string } | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at?: string | null;
  repository?: { id: number; full_name: string };
}
export function normalizePullRequest(
  raw: GitHubPullRequest,
  repositoryId: number,
  repo: string,
  snapshotId: string,
  fetchedAt = new Date().toISOString(),
): PullRequest {
  const merged = Boolean(raw.merged_at);
  return {
    repo,
    repositoryId,
    number: raw.number,
    url: raw.html_url,
    title: raw.title,
    state: merged ? 'merged' : raw.state,
    draft: raw.draft ?? false,
    author: raw.user?.login ?? null,
    labels: (raw.labels ?? []).map((x) => x.name),
    assignees: (raw.assignees ?? []).map((x) => x.login),
    requested_reviewers: (raw.requested_reviewers ?? []).map((x) => x.login),
    requested_teams: (raw.requested_teams ?? []).map((x) => x.name),
    base: raw.base.ref,
    head: raw.head.ref,
    milestone: raw.milestone?.title ?? null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    closed_at: raw.closed_at,
    merged_at: raw.merged_at ?? null,
    fieldCompleteness: {
      repo: true,
      number: true,
      url: true,
      title: true,
      state: true,
      draft: true,
      author: Boolean(raw.user),
      labels: raw.labels !== undefined,
      assignees: raw.assignees !== undefined,
      requested_reviewers: raw.requested_reviewers !== undefined,
      requested_teams: raw.requested_teams !== undefined,
      base: true,
      head: true,
      milestone: raw.milestone !== undefined,
      created_at: true,
      updated_at: true,
      age: true,
      closed_at: raw.closed_at !== undefined,
      merged_at: 'merged_at' in raw,
    },
    sourceUpdatedAt: raw.updated_at,
    fetchedAt,
    snapshotId,
  };
}
