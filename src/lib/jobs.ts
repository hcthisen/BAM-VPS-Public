import PgBoss from "pg-boss";

import { query } from "@/lib/db";
import { getEnv } from "@/lib/env";

export const queueNames = [
  "system.heartbeat",
  "site.initiate",
  "site.onboard",
  "site.wordpress_sync",
  "site.profile_generate",
  "keywords.inventory_audit",
  "keywords.seed_generate",
  "keywords.expand",
  "keywords.cluster_review",
  "keywords.persist",
  "rss.poll",
  "rss.item_ingest",
  "rss.retention_cleanup",
  "news.candidate_select",
  "news.source_scrape",
  "news.rewrite",
  "news.publish",
  "blog.candidate_select",
  "blog.seo_brief_generate",
  "blog.outline_generate",
  "blog.outline_review",
  "blog.draft_generate",
  "blog.draft_review",
  "content.image_plan_generate",
  "content.image_generate",
  "content.image_batch_poll",
  "wordpress.publish",
  "content.backfill_create",
] as const;

export type QueueName = (typeof queueNames)[number];

let cachedBoss: PgBoss | null = null;

export async function getBoss() {
  if (cachedBoss) {
    return cachedBoss;
  }

  cachedBoss = new PgBoss({
    connectionString: getEnv().DATABASE_URL,
  });

  await cachedBoss.start();
  return cachedBoss;
}

export async function closeBoss() {
  if (!cachedBoss) {
    return;
  }

  await cachedBoss.stop();
  cachedBoss = null;
}

export async function enqueueJob(queueName: QueueName, payload: Record<string, unknown> = {}, targetType?: string, targetId?: string) {
  const boss = await getBoss();
  const bossJobId = await boss.send(queueName, payload);

  await query(
    `
      insert into job_runs (boss_job_id, queue_name, status, target_type, target_id, payload_json, message)
      values ($1, $2, 'queued', $3, $4, $5, $6)
    `,
    [bossJobId ?? null, queueName, targetType ?? null, targetId ?? null, JSON.stringify(payload), "Queued from control UI"],
  );
}
