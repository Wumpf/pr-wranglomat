export type PullRequestState = 'open' | 'closed' | 'merged';
export type DataSource = 'github-rest' | 'snapshot-import';
export type Completeness = Record<string, boolean>;

export interface PullRequest {
  repo: string;
  repositoryId: number;
  number: number;
  url: string;
  title: string;
  state: PullRequestState;
  draft: boolean;
  author: string | null;
  labels: string[];
  assignees: string[];
  requested_reviewers: string[];
  requested_teams: string[];
  base: string;
  head: string;
  milestone: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  fieldCompleteness: Completeness;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  snapshotId: string;
}

export type TriState = true | false | 'unknown';
