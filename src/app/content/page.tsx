export const dynamic = "force-dynamic";

import Link from "next/link";
import type { Route } from "next";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { requireAdminSession } from "@/lib/auth/server";
import { listContent } from "@/lib/data/dashboard";
import type { ContentRecord } from "@/lib/types";

function groupBySite(items: ContentRecord[]) {
  const groups = new Map<string, ContentRecord[]>();

  for (const item of items) {
    const bucket = groups.get(item.siteId) ?? [];
    bucket.push(item);
    groups.set(item.siteId, bucket);
  }

  return Array.from(groups.entries()).map(([siteId, rows]) => ({
    siteId,
    siteName: rows[0]?.siteName ?? "Unknown site",
    rows,
  }));
}

export default async function ContentPage() {
  await requireAdminSession();

  const items = await listContent().catch(() => []);
  const groups = groupBySite(items);

  return (
    <div className="page">
      <Panel title="Content Queue">
        {groups.length ? (
          <div className="list">
            {groups.map((group) => (
              <div key={group.siteId} className="list-item">
                <div className="chip-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                  <h3>
                    <Link href={`/sites/${group.siteId}?tab=content`}>{group.siteName}</Link>
                  </h3>
                  <span className="chip">{group.rows.length} items</span>
                </div>
                <div className="table-wrap" style={{ padding: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Kind</th>
                        <th>Title</th>
                        <th>Stage</th>
                        <th>Status</th>
                        <th>Source</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((item) => (
                        <tr key={item.id}>
                          <td>{item.kind}</td>
                          <td>
                            <Link href={`/content/${item.id}` as Route}>
                              {item.title ?? "(untitled draft)"}
                            </Link>
                          </td>
                          <td>
                            <StatusBadge value={item.stage} />
                          </td>
                          <td>
                            <StatusBadge value={item.status} />
                          </td>
                          <td className="mono">{item.sourceKeyword ?? item.sourceUrl ?? "-"}</td>
                          <td>{new Date(item.updatedAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No content yet" description="Content appears here after a site is initiated and automation starts feeding blog or news work." />
        )}
      </Panel>
    </div>
  );
}
