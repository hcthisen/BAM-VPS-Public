export const dynamic = "force-dynamic";

import Link from "next/link";

import { createSiteAction } from "@/app/actions";
import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { requireAdminSession } from "@/lib/auth/server";
import { listSites } from "@/lib/data/dashboard";
import type { SiteRecord } from "@/lib/types";

type SiteGroup = {
  key: string;
  title: string;
  rows: SiteRecord[];
};

function groupSites(sites: SiteRecord[]): SiteGroup[] {
  const attention = sites.filter((site) => site.setupState === "attention");
  const setup = sites.filter((site) => ["needs_setup", "ready_to_initiate", "initializing"].includes(site.setupState));
  const ready = sites.filter((site) => site.setupState === "ready" && site.automationStatus === "off");
  const live = sites.filter((site) => site.setupState === "ready" && site.automationStatus !== "off");

  return [
    { key: "attention", title: "Needs Attention", rows: attention },
    { key: "setup", title: "In Setup", rows: setup },
    { key: "ready", title: "Ready To Go Live", rows: ready },
    { key: "live", title: "Live Automation", rows: live },
  ];
}

function renderSiteTable(rows: SiteRecord[]) {
  if (!rows.length) {
    return <EmptyState title="No sites in this section" description="Sites move here automatically as setup and automation states change." />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Setup</th>
            <th>Automation</th>
            <th>Feeds</th>
            <th>Unused KWs</th>
            <th>Blog/day</th>
            <th>News/day</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((site) => (
            <tr key={site.id}>
              <td>
                <div className="field" style={{ gap: 2 }}>
                  <Link href={`/sites/${site.id}?tab=setup`}>{site.name}</Link>
                  <span className="mono">{site.baseUrl}</span>
                </div>
              </td>
              <td>
                <StatusBadge value={site.setupState.replaceAll("_", " ")} />
              </td>
              <td>
                <StatusBadge value={site.automationStatus} />
              </td>
              <td>{site.feedCount}</td>
              <td>{site.unusedKeywordCount}</td>
              <td>{site.postsPerDay}</td>
              <td>{site.newsPerDay}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function SitesPage() {
  await requireAdminSession();

  const sites = await listSites().catch(() => []);
  const groups = groupSites(sites);

  return (
    <div className="page">
      <Panel title="Add Site">
        <form action={createSiteAction} className="form-grid two">
          <div className="field">
            <label htmlFor="name">Site name</label>
            <input id="name" name="name" placeholder="Example Media Group" required />
          </div>
          <div className="field">
            <label htmlFor="wordpressUrl">WordPress URL</label>
            <input id="wordpressUrl" name="wordpressUrl" placeholder="https://example.com" required />
          </div>
          <div className="field">
            <label>Submit</label>
            <button className="button" type="submit">
              Create site
            </button>
          </div>
        </form>
      </Panel>

      {groups.map((group) => (
        <Panel key={group.key} title={group.title}>
          {renderSiteTable(group.rows)}
        </Panel>
      ))}
    </div>
  );
}
