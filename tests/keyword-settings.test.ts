import { describe, expect, it } from "vitest";

import {
  buildKeywordTargetSequence,
  DEFAULT_KEYWORD_MAX_DIFFICULTY,
  DEFAULT_KEYWORD_MIN_SEARCH_VOLUME,
  deriveKeywordTargetFromMetrics,
  formatKeywordTarget,
  getKeywordSettingsWarning,
  getNextHigherKeywordDifficultyAllowance,
  getNextLowerKeywordVolumeRequirement,
  keywordMatchesTarget,
  normalizeKeywordMaxDifficulty,
  normalizeKeywordMinSearchVolume,
} from "../src/lib/keywords/settings";

describe("keyword settings helpers", () => {
  it("uses the feature defaults", () => {
    expect(DEFAULT_KEYWORD_MAX_DIFFICULTY).toBe(40);
    expect(DEFAULT_KEYWORD_MIN_SEARCH_VOLUME).toBe(100);
  });

  it("normalizes keyword limits into valid ranges", () => {
    expect(normalizeKeywordMaxDifficulty("105")).toBe(100);
    expect(normalizeKeywordMaxDifficulty("-5")).toBe(0);
    expect(normalizeKeywordMinSearchVolume("-20")).toBe(0);
    expect(normalizeKeywordMinSearchVolume("250.8")).toBe(250);
  });

  it("warns on aggressive target combinations and stays quiet on the default target", () => {
    expect(getKeywordSettingsWarning({ maxDifficulty: 40, minSearchVolume: 100 })).toBeNull();
    expect(getKeywordSettingsWarning({ maxDifficulty: 10, minSearchVolume: 5000 })).toContain("aggressive");
    expect(getKeywordSettingsWarning({ maxDifficulty: 20, minSearchVolume: 1000 })).toContain("BAM may need to lower volume");
  });

  it("snaps arbitrary values to the next less-strict relaxation rung", () => {
    expect(getNextLowerKeywordVolumeRequirement(600)).toBe(500);
    expect(getNextLowerKeywordVolumeRequirement(100)).toBe(50);
    expect(getNextLowerKeywordVolumeRequirement(0)).toBeNull();

    expect(getNextHigherKeywordDifficultyAllowance(35)).toBe(40);
    expect(getNextHigherKeywordDifficultyAllowance(40)).toBe(50);
    expect(getNextHigherKeywordDifficultyAllowance(100)).toBeNull();
  });

  it("builds the correct relaxation sequence from the default target", () => {
    const sequence = buildKeywordTargetSequence({
      maxDifficulty: 40,
      minSearchVolume: 100,
    });

    expect(sequence).toEqual([
      { maxDifficulty: 40, minSearchVolume: 100 },
      { maxDifficulty: 40, minSearchVolume: 50 },
      { maxDifficulty: 40, minSearchVolume: 20 },
      { maxDifficulty: 40, minSearchVolume: 10 },
      { maxDifficulty: 40, minSearchVolume: 0 },
      { maxDifficulty: 50, minSearchVolume: 0 },
      { maxDifficulty: 60, minSearchVolume: 0 },
      { maxDifficulty: 70, minSearchVolume: 0 },
      { maxDifficulty: 80, minSearchVolume: 0 },
      { maxDifficulty: 100, minSearchVolume: 0 },
    ]);
  });

  it("preserves an arbitrary starting target before walking down the fixed ladder", () => {
    const sequence = buildKeywordTargetSequence({
      maxDifficulty: 35,
      minSearchVolume: 600,
    });

    expect(sequence).toEqual([
      { maxDifficulty: 35, minSearchVolume: 600 },
      { maxDifficulty: 35, minSearchVolume: 500 },
      { maxDifficulty: 35, minSearchVolume: 250 },
      { maxDifficulty: 35, minSearchVolume: 100 },
      { maxDifficulty: 35, minSearchVolume: 50 },
      { maxDifficulty: 35, minSearchVolume: 20 },
      { maxDifficulty: 35, minSearchVolume: 10 },
      { maxDifficulty: 35, minSearchVolume: 0 },
      { maxDifficulty: 40, minSearchVolume: 0 },
      { maxDifficulty: 50, minSearchVolume: 0 },
      { maxDifficulty: 60, minSearchVolume: 0 },
      { maxDifficulty: 70, minSearchVolume: 0 },
      { maxDifficulty: 80, minSearchVolume: 0 },
      { maxDifficulty: 100, minSearchVolume: 0 },
    ]);
  });

  it("treats missing metrics as non-qualifying and formats targets for messages", () => {
    expect(
      keywordMatchesTarget(
        { difficulty: 40, searchVolume: 100 },
        { maxDifficulty: 40, minSearchVolume: 100 },
      ),
    ).toBe(true);
    expect(
      keywordMatchesTarget(
        { difficulty: 41, searchVolume: 100 },
        { maxDifficulty: 40, minSearchVolume: 100 },
      ),
    ).toBe(false);
    expect(
      keywordMatchesTarget(
        { difficulty: null, searchVolume: 100 },
        { maxDifficulty: 40, minSearchVolume: 100 },
      ),
    ).toBe(false);

    expect(formatKeywordTarget({ maxDifficulty: 40, minSearchVolume: 100 })).toBe("difficulty <= 40, volume >= 100");
  });

  it("tightens a saved target from the final kept keyword inventory", () => {
    expect(
      deriveKeywordTargetFromMetrics(
        [
          { difficulty: 21, searchVolume: 1600 },
          { difficulty: 30, searchVolume: 5400 },
          { difficulty: 27, searchVolume: 2300 },
        ],
        { maxDifficulty: 30, minSearchVolume: 0 },
      ),
    ).toEqual({ maxDifficulty: 30, minSearchVolume: 1600 });
  });

  it("falls back when the kept inventory has no usable metrics", () => {
    expect(
      deriveKeywordTargetFromMetrics(
        [
          { difficulty: null, searchVolume: 1200 },
          { difficulty: 20, searchVolume: null },
        ],
        { maxDifficulty: 40, minSearchVolume: 100 },
      ),
    ).toEqual({ maxDifficulty: 40, minSearchVolume: 100 });
  });
});
