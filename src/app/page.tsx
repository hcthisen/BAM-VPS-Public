export const dynamic = "force-dynamic";

import Link from "next/link";
import type { Route } from "next";

import { runHeartbeatAction } from "@/app/actions";
import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { requireAdminSession } from "@/lib/auth/server";
import { getDashboardMetrics, listContent, listJobs, listSites } from "@/lib/data/dashboard";
import { getSettingsPageSummary } from "@/lib/settings";
import type { ContentRecord, JobRecord, SiteRecord } from "@/lib/types";

type ActionGroup = {
  title: string;
  rows: SiteRecord[];
  actionLabel: string;
};

function buildActionGroups(sites: SiteRecord[]): ActionGroup[] {
  return [
    {
      title: "Needs Setup",
      rows: sites.filter((site) => site.setupState === "needs_setup" || site.setupState === "ready_to_initiate").slice(0, 6),
      actionLabel: "Continue setup",
    },
    {
      title: "Needs Attention",
      rows: sites.filter((site) => site.setupState === "attention").slice(0, 6),
      actionLabel: "Review issue",
    },
  ].filter((group) => group.rows.length > 0);
}

function renderActionGroup(group: ActionGroup) {
  return (
    <div key={group.title} className="list-item">
      <div className="chip-row" style={{ justifyContent: "space-between" }}>
        <h3>{group.title}</h3>
        <Link className="button secondary" href="/sites">
          {group.actionLabel}
        </Link>
      </div>
      <div className="compact-list">
        {group.rows.map((site) => (
          <Link key={site.id} href={`/sites/${site.id}?tab=setup`} className="compact-row">
            <span>{site.name}</span>
            <div className="chip-row">
              <StatusBadge value={site.setupState.replaceAll("_", " ")} />
              <StatusBadge value={site.automationStatus} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function renderRecentJobs(jobs: JobRecord[]) {
  if (!jobs.length) {
    return <EmptyState title="No job history yet" description="Activity appears here as sites are initiated and content runs." />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Queue</th>
            <th>Status</th>
            <th>Target</th>
            <th>Message</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td className="mono">{job.queueName}</td>
              <td>
                <StatusBadge value={job.status} />
              </td>
              <td className="mono">{job.targetType ? `${job.targetType}:${job.targetId}` : "-"}</td>
              <td>{job.message ?? "-"}</td>
              <td>{new Date(job.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderRecentContent(items: ContentRecord[]) {
  if (!items.length) {
    return <EmptyState title="No content yet" description="Articles and news appear here after the worker creates them." />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Site</th>
            <th>Kind</th>
            <th>Stage</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link href={`/content/${item.id}` as Route}>
                  {item.title ?? "(untitled draft)"}
                </Link>
              </td>
              <td>
                <Link href={`/sites/${item.siteId}?tab=content`}>{item.siteName}</Link>
              </td>
              <td>{item.kind}</td>
              <td>
                <StatusBadge value={item.stage.replaceAll("_", " ")} />
              </td>
              <td>{new Date(item.updatedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProviderDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: ok ? "var(--good)" : "var(--bad)", flexShrink: 0 }} />
      {label}
    </span>
  );
}

export default async function HomePage() {
  await requireAdminSession();

  const settings = await getSettingsPageSummary();
  let metrics = null;
  let jobs: JobRecord[] = [];
  let sites: SiteRecord[] = [];
  let content: ContentRecord[] = [];
  let errorMessage: string | null = null;

  try {
    [metrics, jobs, sites, content] = await Promise.all([getDashboardMetrics(), listJobs(8), listSites(), listContent(8)]);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Database not initialized yet.";
  }

  return (
    <div className="page">
      <section className="hero">
        <p className="eyebrow">Operations overview</p>
        <h1>BAM Control</h1>
        <div className="chip-row">
          <ProviderDot label="OpenAI" ok={settings.openai.apiKeyConfigured} />
          <ProviderDot label="DataForSEO" ok={!!(settings.dataforseo.login && settings.dataforseo.apiKeyConfigured)} />
          <ProviderDot label="S3" ok={!!(settings.s3.bucket && settings.s3.accessKeyConfigured && settings.s3.secretKeyConfigured)} />
          <form action={runHeartbeatAction}>
            <input type="hidden" name="returnTo" value="/" />
            <button className="button secondary" type="submit">
              Run heartbeat
            </button>
          </form>
        </div>
      </section>

      {metrics ? (
        <>
          <section className="stats-grid">
            <StatCard label="Sites" value={metrics.siteCount} hint={`${metrics.liveSiteCount} live`} />
            <StatCard label="Needs setup" value={metrics.needsSetupCount} hint="Awaiting setup" />
            <StatCard label="Ready to initiate" value={metrics.readyToInitiateCount} hint="Prerequisites complete" />
            <StatCard label="Initializing" value={metrics.initializingCount} hint="Pipeline running" />
            <StatCard label="Ready" value={metrics.readySiteCount} hint="Automation off" />
            <StatCard label="Attention" value={metrics.attentionCount} hint="Needs review" />
            <StatCard label="Keywords" value={metrics.keywordCount} hint={`${metrics.unusedKeywordCount} unused`} />
            <StatCard label="Content" value={metrics.contentCount} hint={`${metrics.publishReadyCount} publish-ready`} />
          </section>

          <div className="grid-2">
            <Panel title="Action Buckets">
              <div className="list">
                {buildActionGroups(sites).length > 0
                  ? buildActionGroups(sites).map((group) => renderActionGroup(group))
                  : <div className="list-item"><p>All sites are set up and running.</p></div>
                }
              </div>
            </Panel>

            <Panel title="Recent Jobs">
              {renderRecentJobs(jobs)}
            </Panel>
          </div>

          <Panel title="Recent Content">
            {renderRecentContent(content)}
          </Panel>
        </>
      ) : (
        <Panel title="Database status">
          <EmptyState title="Database not ready" description={errorMessage ?? "Missing schema or connection."} />
        </Panel>
      )}
    </div>
  );
}
