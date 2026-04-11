import { describe, expect, it } from "vitest";

import { selectKeywordCandidatesForSlots, type KeywordSelectionCandidate } from "../src/lib/content/keyword-rotation";

function candidate(
  keywordId: string,
  categoryId: string | null,
  index: number,
  recentCategoryCount = 0,
  categoryUsageCount = 0,
): KeywordSelectionCandidate {
  return {
    keywordId,
    categoryId,
    createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    recentCategoryCount,
    categoryUsageCount,
  };
}

describe("selectKeywordCandidatesForSlots", () => {
  it("does not fill a multi-slot batch from one category when alternatives exist", () => {
    const selected = selectKeywordCandidatesForSlots(
      [
        candidate("a-1", "a", 0),
        candidate("a-2", "a", 1),
        candidate("a-3", "a", 2),
        candidate("b-1", "b", 3),
        candidate("c-1", "c", 4),
      ],
      3,
    );

    expect(selected.map((item) => item.categoryId)).toEqual(["a", "b", "c"]);
  });

  it("avoids the category selected immediately before when another category is available", () => {
    const selected = selectKeywordCandidatesForSlots(
      [
        candidate("a-1", "a", 0),
        candidate("a-2", "a", 1),
        candidate("b-1", "b", 2),
      ],
      2,
      "a",
    );

    expect(selected.map((item) => item.categoryId)).toEqual(["b", "a"]);
  });

  it("falls back to the same category when it is the only category with keywords", () => {
    const selected = selectKeywordCandidatesForSlots(
      [candidate("a-1", "a", 0), candidate("a-2", "a", 1)],
      2,
      "a",
    );

    expect(selected.map((item) => item.keywordId)).toEqual(["a-1", "a-2"]);
  });
});
