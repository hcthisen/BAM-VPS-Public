"use client";

import { useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import type { KeywordRecord } from "@/lib/types";

type KeywordTableProps = {
  keywords: KeywordRecord[];
  sites: Array<{ id: string; name: string }>;
};

export function KeywordTable({ keywords, sites }: KeywordTableProps) {
  const [siteFilter, setSiteFilter] = useState("all");

  const filtered = siteFilter === "all"
    ? keywords
    : keywords.filter((k) => k.siteId === siteFilter);

  return (
    <>
      <div className="panel-body" style={{ paddingBottom: 0 }}>
        <div className="field" style={{ maxWidth: 300 }}>
          <label htmlFor="siteFilter">Filter by site</label>
          <select
            id="siteFilter"
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
          >
            <option value="all">All sites ({keywords.length})</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name} ({keywords.filter((k) => k.siteId === site.id).length})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="table-wrap">
        {filtered.length > 0 ? (
          <table>
            <thead>
              <tr>
                {siteFilter === "all" && <th>Site</th>}
                <th>Keyword</th>
                <th>Cluster</th>
                <th>Category</th>
                <th>Volume</th>
                <th>Difficulty</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((keyword) => (
                <tr key={keyword.id}>
                  {siteFilter === "all" && <td>{keyword.siteName}</td>}
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
        ) : (
          <p style={{ padding: "20px 0", color: "var(--muted)", textAlign: "center" }}>
            No keywords match this filter.
          </p>
        )}
      </div>
    </>
  );
}
