import "dotenv/config";

import { getBoss } from "@/lib/jobs";
import { registerWorkers } from "@/worker/jobs/register";

async function main() {
  const boss = await getBoss();
  await registerWorkers(boss);
  console.log("BAM worker started.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
