import { bulkDeleteKeywordsAction, deleteKeywordAction } from "@/app/actions";
import { StatusBadge } from "@/components/status-badge";
import type { KeywordRecord } from "@/lib/types";

type KeywordTableProps = {
  keywords: KeywordRecord[];
  showSiteColumn?: boolean;
  returnTo: string;
  emptyMessage?: string;
};

export function KeywordTable({
  keywords,
  showSiteColumn = true,
  returnTo,
  emptyMessage = "No keywords match this filter.",
}: KeywordTableProps) {
  if (keywords.length === 0) {
    return (
      <p style={{ padding: "20px 0", color: "var(--muted)", textAlign: "center" }}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <form action={bulkDeleteKeywordsAction}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Select</th>
              {showSiteColumn ? <th>Site</th> : null}
              <th>Keyword</th>
              <th>Cluster</th>
              <th>Category</th>
              <th>Volume</th>
              <th>Difficulty</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {keywords.map((keyword) => (
              <tr key={keyword.id}>
                <td>
                  <input type="checkbox" name="keywordIds" value={keyword.id} aria-label={`Select ${keyword.keyword}`} />
                </td>
                {showSiteColumn ? <td>{keyword.siteName}</td> : null}
                <td>{keyword.keyword}</td>
                <td>{keyword.clusterLabel ?? "-"}</td>
                <td>{keyword.categoryName ?? "-"}</td>
                <td>{keyword.searchVolume ?? "-"}</td>
                <td>{keyword.difficulty ?? "-"}</td>
                <td>
                  <StatusBadge value={keyword.used ? "used" : "available"} />
                </td>
                <td>
                  <button
                    className="button danger"
                    type="submit"
                    formAction={deleteKeywordAction}
                    name="keywordId"
                    value={keyword.id}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-body" style={{ paddingTop: 0 }}>
        <div className="chip-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <span className="muted">Select one or more rows to delete them from the keyword inventory.</span>
          <button className="button danger" type="submit">
            Delete selected
          </button>
        </div>
      </div>
    </form>
  );
}
