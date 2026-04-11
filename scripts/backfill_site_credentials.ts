import "dotenv/config";

import { closePool } from "@/lib/db";
import { backfillEncryptedWordPressCredentials } from "@/lib/site-credentials";

async function main() {
  const result = await backfillEncryptedWordPressCredentials();
  console.log(`Encrypted WordPress credentials backfill complete. Rows touched: ${result.updated}.`);
  await closePool();
}

main().catch(async (error) => {
  console.error(error);
  await closePool().catch(() => undefined);
  process.exit(1);
});
