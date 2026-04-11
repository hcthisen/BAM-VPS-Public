import type PgBoss from "pg-boss";

import { queueNames } from "@/lib/jobs";
import { runJob } from "@/worker/jobs/handlers";

const schedules: Array<{ queueName: (typeof queueNames)[number]; cron: string }> = [
  { queueName: "keywords.inventory_audit", cron: "0 */6 * * *" },
  { queueName: "rss.poll", cron: "*/30 * * * *" },
  { queueName: "rss.retention_cleanup", cron: "30 2 * * *" },
  { queueName: "news.candidate_select", cron: "10 * * * *" },
  { queueName: "blog.candidate_select", cron: "20 * * * *" },
  { queueName: "content.image_batch_poll", cron: "*/5 * * * *" },
];

export async function registerWorkers(boss: PgBoss) {
  for (const queueName of queueNames) {
    await boss.createQueue(queueName);
  }

  for (const queueName of queueNames) {
    await boss.work(queueName, async (job) => {
      const jobs = Array.isArray(job) ? job : [job];
      for (const current of jobs) {
        await runJob(current as unknown as Parameters<typeof runJob>[0]);
      }
    });
  }

  for (const schedule of schedules) {
    await boss.schedule(schedule.queueName, schedule.cron);
  }
}
