export const dynamic = "force-dynamic";

import { EmptyState } from "@/components/empty-state";
import { KeywordTable } from "@/components/keyword-table";
import { Panel } from "@/components/panel";
import { requireAdminSession } from "@/lib/auth/server";
import { listKeywords } from "@/lib/data/dashboard";

export default async function KeywordsPage() {
  await requireAdminSession();

  const keywords = await listKeywords(500).catch(() => []);

  // Extract unique sites for the filter dropdown
  const siteMap = new Map<string, string>();
  for (const k of keywords) {
    if (!siteMap.has(k.siteId)) {
      siteMap.set(k.siteId, k.siteName);
    }
  }
  const sites = Array.from(siteMap.entries()).map(([id, name]) => ({ id, name }));

  return (
    <div className="page">
      <Panel title="Keywords">
        {keywords.length > 0 ? (
          <KeywordTable keywords={keywords} sites={sites} />
        ) : (
          <EmptyState title="No keywords yet" description="Keywords appear here after site initiation completes." />
        )}
      </Panel>
    </div>
  );
}
