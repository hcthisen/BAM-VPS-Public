import { query } from "@/lib/db";
import type { JobStatus } from "@/lib/types";

export async function markJobRunning(bossJobId: string, queueName: string, payload: unknown) {
  await query(
    `
      insert into job_runs (boss_job_id, queue_name, status, payload_json, started_at, message)
      values ($1, $2, 'running', $3, now(), 'Worker started job')
      on conflict (boss_job_id) do update
      set status = 'running',
          payload_json = excluded.payload_json,
          started_at = now(),
          message = excluded.message
    `,
    [bossJobId, queueName, JSON.stringify(payload ?? {})],
  );
}

export async function completeJob(bossJobId: string, status: Exclude<JobStatus, "queued" | "running">, result: unknown, message?: string) {
  await query(
    `
      update job_runs
      set status = $2,
          result_json = $3,
          message = coalesce($4, message),
          finished_at = now()
      where boss_job_id = $1
    `,
    [bossJobId, status, JSON.stringify(result ?? {}), message ?? null],
  );
}

