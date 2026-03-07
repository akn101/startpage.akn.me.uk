export const dynamic = "force-dynamic";

const GH_TOKEN = process.env.GITHUB_TOKEN!;
const GH_USER  = "akn101";

type CIState = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | null;

interface GQLPRNode {
  title: string;
  url: string;
  createdAt: string;
  repository: { name: string; owner: { login: string } };
  commits?: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
}
interface GQLRepoNode {
  nameWithOwner: string;
  url: string;
  pushedAt: string;
  defaultBranchRef: { target: { statusCheckRollup: { state: string } | null } | null } | null;
}
interface GQLIssueNode {
  title: string;
  url: string;
  createdAt: string;
  repository: { name: string; owner: { login: string } };
}

async function graphql<T>(query: string): Promise<T | null> {
  if (!GH_TOKEN) return null;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${GH_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.data ?? null;
}

export async function GET() {
  if (!GH_TOKEN) return Response.json({ prs: [], reviews: [], issues: [], repos: [] });

  const query = `{
    myPRs: search(query: "is:pr is:open author:${GH_USER} org:auracarehq org:akn101", type: ISSUE, first: 8) {
      nodes {
        ... on PullRequest {
          title url createdAt
          repository { name owner { login } }
          commits(last: 1) {
            nodes { commit { statusCheckRollup { state } } }
          }
        }
      }
    }
    reviews: search(query: "is:pr is:open review-requested:${GH_USER} org:auracarehq org:akn101", type: ISSUE, first: 5) {
      nodes {
        ... on PullRequest {
          title url createdAt
          repository { name owner { login } }
        }
      }
    }
    issues: search(query: "is:issue is:open assignee:${GH_USER} org:auracarehq org:akn101", type: ISSUE, first: 8) {
      nodes {
        ... on Issue {
          title url createdAt
          repository { name owner { login } }
        }
      }
    }
  }`;

  const reposQuery = `{
    viewer {
      repositoriesContributedTo(
        first: 10
        includeUserRepositories: true
        contributionTypes: [COMMIT, PULL_REQUEST]
        orderBy: { field: PUSHED_AT, direction: DESC }
      ) {
        nodes {
          nameWithOwner url pushedAt
          defaultBranchRef { target { ... on Commit { statusCheckRollup { state } } } }
        }
      }
    }
    org: organization(login: "auracarehq") {
      repositories(first: 20, orderBy: { field: PUSHED_AT, direction: DESC }) {
        nodes {
          nameWithOwner url pushedAt
          defaultBranchRef { target { ... on Commit { statusCheckRollup { state } } } }
        }
      }
    }
  }`;

  const [gql, reposGql] = await Promise.all([
    graphql<{
      myPRs:   { nodes: GQLPRNode[] };
      reviews: { nodes: GQLPRNode[] };
      issues:  { nodes: GQLIssueNode[] };
    }>(query),
    graphql<{
      viewer: {
        repositoriesContributedTo: { nodes: GQLRepoNode[] };
      };
      org: {
        repositories: { nodes: GQLRepoNode[] };
      } | null;
    }>(reposQuery),
  ]);

  const prs = (gql?.myPRs?.nodes ?? []).map((n) => ({
    title: n.title,
    url: n.url,
    repo: n.repository.name,
    owner: n.repository.owner.login,
    createdAt: n.createdAt,
    ci: (n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null) as CIState,
  }));

  const reviews = (gql?.reviews?.nodes ?? []).map((n) => ({
    title: n.title,
    url: n.url,
    repo: n.repository.name,
    owner: n.repository.owner.login,
    createdAt: n.createdAt,
    ci: null as CIState,
  }));

  const issues = (gql?.issues?.nodes ?? []).map((n) => ({
    title: n.title,
    url: n.url,
    repo: n.repository.name,
    owner: n.repository.owner.login,
    createdAt: n.createdAt,
    ci: null as CIState,
  }));

  const repoNodes: GQLRepoNode[] = [
    ...(reposGql?.viewer?.repositoriesContributedTo?.nodes ?? []),
    ...(reposGql?.org?.repositories?.nodes ?? []),
  ].filter(Boolean) as GQLRepoNode[];
  // Deduplicate by URL, keep latest pushedAt, sort descending
  const repoMap = new Map<string, GQLRepoNode>();
  for (const r of repoNodes) {
    const existing = repoMap.get(r.url);
    if (!existing || r.pushedAt > existing.pushedAt) repoMap.set(r.url, r);
  }
  const repos = [...repoMap.values()]
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))
    .slice(0, 20)
    .map((r) => {
      const [owner, name] = r.nameWithOwner.split("/");
      const ci = (r.defaultBranchRef?.target?.statusCheckRollup?.state ?? null) as CIState;
      return { name, owner, url: r.url, pushedAt: r.pushedAt, ci };
    });

  return Response.json({ prs, reviews, issues, repos });
}
