import Link from "next/link";
import type { Route } from "next";

type PaginationNavProps = {
  pathname: string;
  currentPage: number;
  pageSize: number;
  totalCount: number;
  query?: Record<string, string | number | null | undefined>;
  pageParamName?: string;
};

function buildHref(
  pathname: string,
  page: number,
  pageParamName: string,
  query: Record<string, string | number | null | undefined>,
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    params.set(key, String(value));
  }

  if (page > 1) {
    params.set(pageParamName, String(page));
  } else {
    params.delete(pageParamName);
  }

  const queryString = params.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

export function PaginationNav({
  pathname,
  currentPage,
  pageSize,
  totalCount,
  query = {},
  pageParamName = "page",
}: PaginationNavProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const current = Math.min(Math.max(currentPage, 1), totalPages);

  if (totalCount <= pageSize) {
    return null;
  }

  const startItem = totalCount === 0 ? 0 : (current - 1) * pageSize + 1;
  const endItem = Math.min(current * pageSize, totalCount);
  const pageStart = Math.max(1, current - 2);
  const pageEnd = Math.min(totalPages, current + 2);
  const pages: number[] = [];

  for (let page = pageStart; page <= pageEnd; page += 1) {
    pages.push(page);
  }

  return (
    <div className="chip-row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
      <span className="chip">
        Showing {startItem}-{endItem} of {totalCount}
      </span>

      <div className="tab-row" aria-label="Pagination">
        {current > 1 ? (
          <Link className="button secondary" href={buildHref(pathname, current - 1, pageParamName, query) as Route}>
            Previous
          </Link>
        ) : (
          <span className="chip">Previous</span>
        )}

        {pageStart > 1 ? <Link className="tab-link" href={buildHref(pathname, 1, pageParamName, query) as Route}>1</Link> : null}
        {pageStart > 2 ? <span className="chip">…</span> : null}

        {pages.map((page) =>
          page === current ? (
            <span key={page} className="tab-link active" aria-current="page">
              {page}
            </span>
          ) : (
            <Link key={page} className="tab-link" href={buildHref(pathname, page, pageParamName, query) as Route}>
              {page}
            </Link>
          ),
        )}

        {pageEnd < totalPages - 1 ? <span className="chip">…</span> : null}
        {pageEnd < totalPages ? (
          <Link className="tab-link" href={buildHref(pathname, totalPages, pageParamName, query) as Route}>
            {totalPages}
          </Link>
        ) : null}

        {current < totalPages ? (
          <Link className="button secondary" href={buildHref(pathname, current + 1, pageParamName, query) as Route}>
            Next
          </Link>
        ) : (
          <span className="chip">Next</span>
        )}
      </div>
    </div>
  );
}
