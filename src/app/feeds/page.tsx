export const dynamic = "force-dynamic";

import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { requireAdminSession } from "@/lib/auth/server";
import { listFeeds } from "@/lib/data/dashboard";
import type { FeedRecord } from "@/lib/types";

function groupBySite(feeds: FeedRecord[]) {
  const groups = new Map<string, FeedRecord[]>();

  for (const feed of feeds) {
    const bucket = groups.get(feed.siteId) ?? [];
    bucket.push(feed);
    groups.set(feed.siteId, bucket);
  }

  return Array.from(groups.entries()).map(([siteId, rows]) => ({
    siteId,
    siteName: rows[0]?.siteName ?? "Unknown site",
    rows,
  }));
}

export default async function FeedsPage() {
  await requireAdminSession();

  const feeds = await listFeeds().catch(() => []);
  const groups = groupBySite(feeds);

  return (
    <div className="page">
      <Panel title="Feed Subscriptions">
        {groups.length ? (
          <div className="list">
            {groups.map((group) => (
              <div key={group.siteId} className="list-item">
                <div className="chip-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                  <h3>
                    <Link href={`/sites/${group.siteId}?tab=feeds`}>{group.siteName}</Link>
                  </h3>
                  <span className="chip">{group.rows.length} feeds</span>
                </div>
                <div className="table-wrap" style={{ padding: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Feed</th>
                        <th>URL</th>
                        <th>Category</th>
                        <th>Status</th>
                        <th>Poll</th>
                        <th>Last Polled</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((feed) => (
                        <tr key={feed.id}>
                          <td>{feed.title}</td>
                          <td className="mono">{feed.url}</td>
                          <td>{feed.categoryLabel ?? "-"}</td>
                          <td>
                            <StatusBadge value={feed.active ? "active" : "paused"} />
                          </td>
                          <td>{feed.pollMinutes} min</td>
                          <td>{feed.lastPolledAt ? new Date(feed.lastPolledAt).toLocaleString() : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No feed subscriptions" description="Feeds appear here after they are added inside a site's Feeds tab." />
        )}
      </Panel>
    </div>
  );
}
