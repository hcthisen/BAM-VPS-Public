"use client";

import { useActionState } from "react";

import { applyUpdateAction, checkForUpdatesAction, type AppUpdateResult } from "@/app/actions";

type UpdatePanelProps = {
  currentHash: string;
  branch: string;
};

export function UpdatePanel({ currentHash, branch }: UpdatePanelProps) {
  const [checkResult, checkAction, isChecking] = useActionState<AppUpdateResult | null, unknown>(checkForUpdatesAction, null);
  const [updateResult, updateAction, isUpdating] = useActionState<AppUpdateResult | null, unknown>(applyUpdateAction, null);

  const hasUpdates = checkResult?.ok === true && checkResult.newVersion;
  const latestResult = updateResult ?? checkResult;

  return (
    <div className="panel-body">
      <div className="list-item" style={{ marginBottom: 12 }}>
        <span className="eyebrow">Current version</span>
        <h3 style={{ fontFamily: "monospace" }}>{currentHash}</h3>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
          Branch: {branch}
        </p>
      </div>

      {latestResult && (
        <div
          className={latestResult.ok ? "status-badge status-good" : "status-badge status-bad"}
          style={{ display: "block", padding: "10px 14px", borderRadius: 6, marginBottom: 12, fontSize: "0.85rem", whiteSpace: "normal" }}
        >
          {latestResult.message}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <form action={checkAction}>
          <button className="button secondary" type="submit" disabled={isChecking || isUpdating}>
            {isChecking ? "Checking..." : "Check for updates"}
          </button>
        </form>

        {hasUpdates && (!updateResult || !updateResult.ok) && (
          <form action={updateAction}>
            <button className="button" type="submit" disabled={isUpdating}>
              {isUpdating ? "Updating..." : "Apply update"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
