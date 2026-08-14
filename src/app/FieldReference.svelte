<script lang="ts">
</script>

<details class="field-reference">
  <summary>
    <span>Field reference</span>
    <small>Types, operators, values, and query examples</small>
  </summary>

  <div class="reference-content">
    <p class="introduction">
      Field names and keywords are case-insensitive. Text comparisons are also
      case-insensitive. Put text in quotes, write dates in ISO format, and use
      <code>true</code>, <code>false</code>, or <code>null</code> without quotes.
    </p>

    <section aria-labelledby="identity-fields">
      <h3 id="identity-fields">Identity and text</h3>
      <div class="reference-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Type</th>
              <th scope="col">Meaning</th>
              <th scope="col">Example</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row"><code>repo</code></th>
              <td>Text</td>
              <td>Repository in <code>owner/name</code> form</td>
              <td><code>repo = "acme/app"</code></td>
            </tr>
            <tr>
              <th scope="row"><code>number</code></th>
              <td>Number</td>
              <td>Pull request number within its repository</td>
              <td><code>number &gt;= 100</code></td>
            </tr>
            <tr>
              <th scope="row"><code>url</code></th>
              <td>Text</td>
              <td>Full GitHub pull request URL</td>
              <td><code>url CONTAINS "/pull/"</code></td>
            </tr>
            <tr>
              <th scope="row"><code>title</code></th>
              <td>Text</td>
              <td>Pull request title</td>
              <td><code>title CONTAINS "release"</code></td>
            </tr>
            <tr>
              <th scope="row"><code>author</code></th>
              <td>Text or null</td>
              <td>Author's GitHub login; null if it is unavailable</td>
              <td><code>author = "octocat"</code></td>
            </tr>
            <tr>
              <th scope="row"><code>base</code></th>
              <td>Text</td>
              <td>Target branch</td>
              <td><code>base = "main"</code></td>
            </tr>
            <tr>
              <th scope="row"><code>head</code></th>
              <td>Text</td>
              <td>Source branch</td>
              <td><code>head STARTS WITH "release/"</code></td>
            </tr>
            <tr>
              <th scope="row"><code>milestone</code></th>
              <td>Text or null</td>
              <td>Milestone title</td>
              <td><code>milestone IS NULL</code></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section aria-labelledby="status-fields">
      <h3 id="status-fields">Status and review</h3>
      <div class="reference-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Type</th>
              <th scope="col">Values and meaning</th>
              <th scope="col">Example</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row"><code>state</code></th>
              <td>Text</td>
              <td
                ><code>open</code>, <code>closed</code>, or
                <code>merged</code></td
              >
              <td><code>state IN ["open", "merged"]</code></td>
            </tr>
            <tr>
              <th scope="row"><code>draft</code></th>
              <td>Boolean</td>
              <td>Whether an open pull request is a draft</td>
              <td><code>draft = false</code></td>
            </tr>
            <tr>
              <th scope="row"><code>review_state</code></th>
              <td>Text or null</td>
              <td>
                <code>approved</code>, <code>changes_requested</code>, or
                <code>review_required</code>. Available in GraphQL snapshots.
              </td>
              <td><code>review_state = "approved"</code></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="note">
        GitHub represents a draft as <code>state = "open"</code> and
        <code>draft = true</code>. <code>state = "draft"</code> does not match drafts.
      </p>
    </section>

    <section aria-labelledby="collection-fields">
      <h3 id="collection-fields">Collections</h3>
      <p>
        Collection fields contain lists of GitHub logins or names. Use
        <code>ANY</code>, <code>ALL</code>, or <code>NONE</code> with a list.
        Use
        <code>IS EMPTY</code> or <code>IS NOT EMPTY</code> to test whether a list
        has values.
      </p>
      <div class="reference-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Contains</th>
              <th scope="col">Example</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row"><code>labels</code></th>
              <td>Label names</td>
              <td><code>labels ANY ["bug", "security"]</code></td>
            </tr>
            <tr>
              <th scope="row"><code>assignees</code></th>
              <td>Assigned user logins</td>
              <td><code>assignees NONE ["bot"]</code></td>
            </tr>
            <tr>
              <th scope="row"><code>requested_reviewers</code></th>
              <td>Requested user logins</td>
              <td><code>requested_reviewers ANY ["alice"]</code></td>
            </tr>
            <tr>
              <th scope="row"><code>requested_teams</code></th>
              <td>Requested team slugs</td>
              <td><code>requested_teams IS NOT EMPTY</code></td>
            </tr>
            <tr>
              <th scope="row"><code>reviewed_by</code></th>
              <td>
                Logins with review activity, including approvals, change
                requests, comments, and dismissed reviews; GraphQL only
              </td>
              <td><code>reviewed_by ALL ["alice", "bob"]</code></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section aria-labelledby="time-fields">
      <h3 id="time-fields">Dates and age</h3>
      <div class="reference-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Type</th>
              <th scope="col">Meaning</th>
              <th scope="col">Example</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row"><code>created_at</code></th>
              <td>Date</td>
              <td>Creation time</td>
              <td><code>created_at &gt;= 2025-01-01</code></td>
            </tr>
            <tr>
              <th scope="row"><code>updated_at</code></th>
              <td>Date</td>
              <td>Most recent update time</td>
              <td><code>updated_at &lt; 2025-06-01</code></td>
            </tr>
            <tr>
              <th scope="row"><code>closed_at</code></th>
              <td>Date or null</td>
              <td>Close time</td>
              <td><code>closed_at IS NOT NULL</code></td>
            </tr>
            <tr>
              <th scope="row"><code>merged_at</code></th>
              <td>Date or null</td>
              <td>Merge time</td>
              <td><code>merged_at IS NULL</code></td>
            </tr>
            <tr>
              <th scope="row"><code>age</code></th>
              <td>Duration</td>
              <td>Time since <code>updated_at</code></td>
              <td><code>age &gt; 14d</code></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="note">
        Durations support <code>ms</code>, <code>s</code>, <code>m</code>,
        <code>h</code>, <code>d</code>, and <code>w</code> units. For example,
        use <code>6h</code>, <code>14d</code>, or <code>2w</code>.
      </p>
    </section>

    <section aria-labelledby="operator-guide">
      <h3 id="operator-guide">Operators and complete examples</h3>
      <dl class="operator-list">
        <div>
          <dt>Text</dt>
          <dd>
            <code>=</code>, <code>!=</code>, <code>IN</code>,
            <code>NOT IN</code>, <code>CONTAINS</code>,
            <code>STARTS WITH</code>, and <code>ENDS WITH</code>
          </dd>
        </div>
        <div>
          <dt>Numbers, dates, and durations</dt>
          <dd>
            <code>=</code>, <code>!=</code>, <code>&lt;</code>,
            <code>&lt;=</code>, <code>&gt;</code>, <code>&gt;=</code>,
            <code>IN</code>, and <code>NOT IN</code>
          </dd>
        </div>
        <div>
          <dt>Logic and output</dt>
          <dd>
            Combine conditions with <code>AND</code>, <code>OR</code>,
            <code>NOT</code>, and parentheses. Add <code>ORDER BY</code> and
            <code>LIMIT</code> after the conditions.
          </dd>
        </div>
      </dl>
      <div class="examples" aria-label="Complete filter examples">
        <pre><code
            >state = "open" AND draft = false
ORDER BY updated_at DESC</code
          ></pre>
        <pre><code
            >labels ANY ["bug", "security"] AND age &gt; 7d
ORDER BY age DESC LIMIT 50</code
          ></pre>
        <pre><code
            >(requested_reviewers IS EMPTY AND requested_teams IS EMPTY)
AND review_state != "approved"</code
          ></pre>
      </div>
      <p class="note">
        If a snapshot does not contain a field, a condition that needs it is
        <strong>unknown</strong>, not false. The match summary lists unavailable
        fields. Refresh with GraphQL to query <code>review_state</code> or
        <code>reviewed_by</code>.
      </p>
    </section>
  </div>
</details>

<style>
  .field-reference {
    margin-top: 12px;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    background: #f6f8fa;
  }
  summary {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 10px 12px;
    color: #0969da;
    cursor: pointer;
    font-weight: 600;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary::before {
    content: '▶';
    color: #57606a;
    font-size: 10px;
    transition: transform 0.15s ease;
  }
  details[open] summary::before {
    transform: rotate(90deg);
  }
  summary small {
    color: #57606a;
    font-weight: 400;
  }
  .reference-content {
    padding: 0 12px 14px;
    border-top: 1px solid #d8dee4;
    background: #fff;
  }
  .introduction {
    margin-top: 14px;
  }
  section + section {
    margin-top: 20px;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 14px;
  }
  p {
    margin: 8px 0;
    color: #57606a;
  }
  code {
    border: 1px solid #d0d7de;
    border-radius: 3px;
    padding: 1px 4px;
    background: #f6f8fa;
    font-size: 12px;
  }
  .reference-table-wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    min-width: 690px;
    border-collapse: collapse;
    font-size: 13px;
  }
  th,
  td {
    padding: 7px 8px;
    border: 1px solid #d8dee4;
    text-align: left;
    vertical-align: top;
  }
  thead th {
    background: #f6f8fa;
    color: #57606a;
    font-size: 12px;
  }
  tbody th {
    white-space: nowrap;
  }
  td:last-child {
    white-space: nowrap;
  }
  .note {
    padding: 8px 10px;
    border-left: 3px solid #54aeff;
    background: #ddf4ff;
    color: #1f2328;
  }
  .operator-list {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin: 0;
  }
  .operator-list div {
    padding: 9px;
    border: 1px solid #d8dee4;
    border-radius: 6px;
  }
  dt {
    margin-bottom: 4px;
    font-weight: 600;
  }
  dd {
    margin: 0;
    color: #57606a;
  }
  .examples {
    display: grid;
    gap: 8px;
    margin-top: 10px;
  }
  pre {
    overflow-x: auto;
    margin: 0;
    padding: 9px 10px;
    border-radius: 6px;
    background: #24292f;
    color: #f0f6fc;
  }
  pre code {
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    line-height: 1.5;
  }
  @media (max-width: 700px) {
    summary {
      align-items: flex-start;
      flex-wrap: wrap;
    }
    summary small {
      width: 100%;
      margin-left: 18px;
    }
    .operator-list {
      grid-template-columns: 1fr;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    summary::before {
      transition: none;
    }
  }
</style>
