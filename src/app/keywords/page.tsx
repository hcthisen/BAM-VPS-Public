export const dynamic = "force-dynamic";

import { EmptyState } from "@/components/empty-state";
import { KeywordTable } from "@/components/keyword-table";
import { PaginationNav } from "@/components/pagination-nav";
import { Panel } from "@/components/panel";
import { requireAdminSession } from "@/lib/auth/server";
import { listKeywordsPage } from "@/lib/data/dashboard";
import type { KeywordUsageFilter } from "@/lib/types";

type KeywordsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const PAGE_SIZE_OPTIONS = [50, 100, 250] as const;

function getSingleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseKeywordUsageFilter(value: string | undefined): KeywordUsageFilter {
  return value === "available" || value === "used" ? value : "all";
}

export default async function KeywordsPage({ searchParams }: KeywordsPageProps) {
  await requireAdminSession();

  const params = searchParams ? await searchParams : {};
  const siteId = getSingleParam(params.siteId);
  const errorParam = getSingleParam(params.error);
  const page = parsePositiveInt(getSingleParam(params.page), 1);
  const requestedPageSize = parsePositiveInt(getSingleParam(params.pageSize), 100);
  const pageSize = PAGE_SIZE_OPTIONS.includes(requestedPageSize as (typeof PAGE_SIZE_OPTIONS)[number]) ? requestedPageSize : 100;
  const selectedSiteId = siteId && siteId !== "all" ? siteId : null;
  const keywordStatus = parseKeywordUsageFilter(getSingleParam(params.keywordStatus));
  const errorMessage = errorParam ? decodeURIComponent(errorParam) : null;

  const keywordPage = await listKeywordsPage({
    page,
    pageSize,
    siteId: selectedSiteId,
    status: keywordStatus,
  }).catch(() => ({
    keywords: [],
    currentPage: 1,
    pageSize,
    totalCount: 0,
    totalPages: 1,
    sites: [],
  }));
  const allSiteKeywordCount = keywordPage.sites.reduce((sum, site) => sum + site.keywordCount, 0);
  const emptyTitle = selectedSiteId || keywordStatus !== "all" ? "No matching keywords" : "No keywords yet";
  const emptyDescription =
    selectedSiteId || keywordStatus !== "all"
      ? "No keywords match the current site and status filters."
      : "Keywords appear here after site initiation completes.";
  const returnParams = new URLSearchParams();
  if (selectedSiteId) {
    returnParams.set("siteId", selectedSiteId);
  }
  if (keywordStatus !== "all") {
    returnParams.set("keywordStatus", keywordStatus);
  }
  if (keywordPage.pageSize !== 100) {
    returnParams.set("pageSize", String(keywordPage.pageSize));
  }
  if (keywordPage.currentPage > 1) {
    returnParams.set("page", String(keywordPage.currentPage));
  }
  const returnTo = returnParams.size > 0 ? `/keywords?${returnParams.toString()}` : "/keywords";

  return (
    <div className="page">
      <Panel title="Keywords">
        {errorMessage ? <p className="form-error" style={{ margin: "16px 20px 0" }}>{errorMessage}</p> : null}
        <div className="panel-body" style={{ paddingBottom: 0 }}>
          <form method="get" className="chip-row" style={{ alignItems: "end", justifyContent: "space-between" }}>
            <div className="field" style={{ minWidth: 220, maxWidth: 320 }}>
              <label htmlFor="siteFilter">Filter by site</label>
              <select id="siteFilter" name="siteId" defaultValue={selectedSiteId ?? "all"}>
                <option value="all">All sites ({allSiteKeywordCount})</option>
                {keywordPage.sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name} ({site.keywordCount})
                  </option>
                ))}
              </select>
            </div>

            <div className="field" style={{ width: 160 }}>
              <label htmlFor="keywordStatus">Filter by status</label>
              <select id="keywordStatus" name="keywordStatus" defaultValue={keywordStatus}>
                <option value="all">All statuses</option>
                <option value="available">Available</option>
                <option value="used">Used</option>
              </select>
            </div>

            <div className="field" style={{ width: 110 }}>
              <label htmlFor="pageSize">Rows</label>
              <select id="pageSize" name="pageSize" defaultValue={String(pageSize)}>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <button className="button secondary" type="submit">
              Apply
            </button>
          </form>
        </div>

        {keywordPage.totalCount > 0 ? (
          <>
            <KeywordTable keywords={keywordPage.keywords} showSiteColumn={!selectedSiteId} returnTo={returnTo} />
            <div className="panel-body" style={{ paddingTop: 12 }}>
              <PaginationNav
                pathname="/keywords"
                currentPage={keywordPage.currentPage}
                pageSize={keywordPage.pageSize}
                totalCount={keywordPage.totalCount}
                query={{
                  siteId: selectedSiteId ?? undefined,
                  keywordStatus: keywordStatus !== "all" ? keywordStatus : undefined,
                  pageSize: keywordPage.pageSize,
                }}
              />
            </div>
          </>
        ) : (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        )}
      </Panel>
    </div>
  );
}
