type StatusBadgeProps = {
  value: string | null | undefined;
};

export function StatusBadge({ value }: StatusBadgeProps) {
  const normalized = (value ?? "unknown").toLowerCase();
  const tone =
    normalized.includes("fail") || normalized.includes("error") || normalized.includes("attention")
      ? "bad"
      : normalized.includes("ready") ||
          normalized.includes("active") ||
          normalized.includes("published") ||
          normalized.includes("passed") ||
          normalized.includes("configured") ||
          normalized === "on" ||
          normalized.includes("blog only") ||
          normalized.includes("news only") ||
          normalized.includes("live")
        ? "good"
      : normalized.includes("run") ||
          normalized.includes("progress") ||
          normalized.includes("initial") ||
          normalized.includes("pending") ||
          normalized.includes("review")
        ? "warn"
      : "neutral";

  return <span className={`status-badge status-${tone}`}>{value ?? "unknown"}</span>;
}

