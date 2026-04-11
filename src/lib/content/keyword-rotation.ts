export type KeywordSelectionCandidate = {
  keywordId: string;
  categoryId: string | null;
  createdAt: Date | string;
  recentCategoryCount: number;
  categoryUsageCount: number;
};

const UNCATEGORIZED_KEY = "__uncategorized__";

function categoryKey(categoryId: string | null | undefined) {
  return categoryId ?? UNCATEGORIZED_KEY;
}

function createdAtMs(value: Date | string) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function selectKeywordCandidatesForSlots(
  candidates: KeywordSelectionCandidate[],
  slots: number,
  previousCategoryId?: string | null,
) {
  const pool = [...candidates];
  const selected: KeywordSelectionCandidate[] = [];
  const selectedCategoryCounts = new Map<string, number>();
  let lastCategoryKey = previousCategoryId === undefined ? null : categoryKey(previousCategoryId);

  while (pool.length > 0 && selected.length < slots) {
    const hasAlternativeToLast =
      lastCategoryKey !== null && pool.some((candidate) => categoryKey(candidate.categoryId) !== lastCategoryKey);

    pool.sort((a, b) => {
      const aCategoryKey = categoryKey(a.categoryId);
      const bCategoryKey = categoryKey(b.categoryId);
      const aRepeatsLast = hasAlternativeToLast && aCategoryKey === lastCategoryKey ? 1 : 0;
      const bRepeatsLast = hasAlternativeToLast && bCategoryKey === lastCategoryKey ? 1 : 0;
      if (aRepeatsLast !== bRepeatsLast) return aRepeatsLast - bRepeatsLast;

      const aEffectiveCount = a.recentCategoryCount + (selectedCategoryCounts.get(aCategoryKey) ?? 0);
      const bEffectiveCount = b.recentCategoryCount + (selectedCategoryCounts.get(bCategoryKey) ?? 0);
      if (aEffectiveCount !== bEffectiveCount) return aEffectiveCount - bEffectiveCount;

      if (a.categoryUsageCount !== b.categoryUsageCount) return a.categoryUsageCount - b.categoryUsageCount;

      const aCreatedAt = createdAtMs(a.createdAt);
      const bCreatedAt = createdAtMs(b.createdAt);
      if (aCreatedAt !== bCreatedAt) return aCreatedAt - bCreatedAt;

      return a.keywordId.localeCompare(b.keywordId);
    });

    const next = pool.shift();
    if (!next) break;

    selected.push(next);
    const nextCategoryKey = categoryKey(next.categoryId);
    selectedCategoryCounts.set(nextCategoryKey, (selectedCategoryCounts.get(nextCategoryKey) ?? 0) + 1);
    lastCategoryKey = nextCategoryKey;
  }

  return selected;
}
