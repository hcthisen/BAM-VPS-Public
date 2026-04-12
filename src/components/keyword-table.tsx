import { StatusBadge } from "@/components/status-badge";
import type { KeywordRecord } from "@/lib/types";

type KeywordTableProps = {
  keywords: KeywordRecord[];
  showSiteColumn?: boolean;
};

export function KeywordTable({ keywords, showSiteColumn = true }: KeywordTableProps) {
  if (keywords.length === 0) {
    return (
      <p style={{ padding: "20px 0", color: "var(--muted)", textAlign: "center" }}>
        No keywords match this filter.
      </p>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {showSiteColumn ? <th>Site</th> : null}
            <th>Keyword</th>
            <th>Cluster</th>
            <th>Category</th>
            <th>Volume</th>
            <th>Difficulty</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {keywords.map((keyword) => (
            <tr key={keyword.id}>
              {showSiteColumn ? <td>{keyword.siteName}</td> : null}
              <td>{keyword.keyword}</td>
              <td>{keyword.clusterLabel ?? "-"}</td>
              <td>{keyword.categoryName ?? "-"}</td>
              <td>{keyword.searchVolume ?? "-"}</td>
              <td>{keyword.difficulty ?? "-"}</td>
              <td>
                <StatusBadge value={keyword.used ? "used" : "available"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
