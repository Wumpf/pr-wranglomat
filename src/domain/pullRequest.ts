export type PullRequestState = 'open' | 'closed' | 'merged';
export type PullRequestStatus = PullRequestState | 'draft';
export type ReviewState = 'approved' | 'changes_requested' | 'review_required';
export type DataSource = 'github-rest' | 'github-graphql' | 'snapshot-import';
export type Completeness = Record<string, boolean>;

export interface PullRequest {
  repo: string;
  repositoryId: number;
  number: number;
  url: string;
  title: string;
  state: PullRequestState;
  review_state: ReviewState | null;
  draft: boolean;
  author: string | null;
  labels: string[];
  assignees: string[];
  requested_reviewers: string[];
  requested_teams: string[];
  reviewed_by: string[];
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

export function pullRequestStatus(
  pullRequest: Pick<PullRequest, 'state' | 'draft'>,
): PullRequestStatus {
  return pullRequest.state === 'open' && pullRequest.draft
    ? 'draft'
    : pullRequest.state;
}

export type TriState = true | false | 'unknown';
