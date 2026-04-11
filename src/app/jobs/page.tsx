export const dynamic = "force-dynamic";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { requireAdminSession } from "@/lib/auth/server";
import { listJobs } from "@/lib/data/dashboard";

export default async function JobsPage() {
  await requireAdminSession();

  const jobs = await listJobs(150).catch(() => []);

  return (
    <div className="page">
      <Panel title="Job History">
        {jobs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Queue</th>
                  <th>Status</th>
                  <th>Target</th>
                  <th>Message</th>
                  <th>Created</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="mono">{job.queueName}</td>
                    <td>
                      <StatusBadge value={job.status} />
                    </td>
                    <td className="mono">{job.targetType && job.targetId ? `${job.targetType}:${job.targetId}` : "-"}</td>
                    <td>{job.message ?? "-"}</td>
                    <td>{new Date(job.createdAt).toLocaleString()}</td>
                    <td>{job.finishedAt ? new Date(job.finishedAt).toLocaleString() : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No jobs yet" description="Job history will appear here as sites are initiated and content moves through the worker." />
        )}
      </Panel>
    </div>
  );
}
