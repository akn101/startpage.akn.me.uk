export const revalidate = 300; // ISR: cache route for 5 min

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

  const [gql, eventsRes] = await Promise.all([
    graphql<{
      myPRs:   { nodes: GQLPRNode[] };
      reviews: { nodes: GQLPRNode[] };
      issues:  { nodes: GQLIssueNode[] };
    }>(query),
    fetch(`https://api.github.com/users/${GH_USER}/events?per_page=50`, {
      headers: { Authorization: `Bearer ${GH_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28" },
    }),
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

  let repos: { name: string; owner: string; url: string; pushedAt: string }[] = [];
  if (eventsRes.ok) {
    const events: { type: string; repo: { name: string }; created_at: string }[] = await eventsRes.json();
    const seen = new Set<string>();
    for (const ev of events) {
      if (ev.type === "PushEvent" && ev.repo && !seen.has(ev.repo.name)) {
        seen.add(ev.repo.name);
        const [owner, name] = ev.repo.name.split("/");
        repos.push({ name, owner, url: `https://github.com/${ev.repo.name}`, pushedAt: ev.created_at });
        if (repos.length >= 6) break;
      }
    }
  }

  return Response.json({ prs, reviews, issues, repos });
}
