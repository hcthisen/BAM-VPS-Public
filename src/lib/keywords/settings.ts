export const DEFAULT_KEYWORD_MAX_DIFFICULTY = 40;
export const DEFAULT_KEYWORD_MIN_SEARCH_VOLUME = 100;

export const KEYWORD_VOLUME_RELAXATION_STEPS = [5000, 2500, 1000, 500, 250, 100, 50, 20, 10, 0] as const;
export const KEYWORD_DIFFICULTY_RELAXATION_STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 100] as const;

export type KeywordTarget = {
  maxDifficulty: number;
  minSearchVolume: number;
};

type KeywordMetric = {
  difficulty: number | null;
  searchVolume: number | null;
};

export function normalizeKeywordMaxDifficulty(
  value: unknown,
  fallback = DEFAULT_KEYWORD_MAX_DIFFICULTY,
) {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? fallback), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.floor(parsed)));
}

export function normalizeKeywordMinSearchVolume(
  value: unknown,
  fallback = DEFAULT_KEYWORD_MIN_SEARCH_VOLUME,
) {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? fallback), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.floor(parsed));
}

export function normalizeKeywordTarget(target: Partial<KeywordTarget> | null | undefined): KeywordTarget {
  return {
    maxDifficulty: normalizeKeywordMaxDifficulty(target?.maxDifficulty),
    minSearchVolume: normalizeKeywordMinSearchVolume(target?.minSearchVolume),
  };
}

export function getKeywordSettingsWarningScore(target: KeywordTarget) {
  const normalized = normalizeKeywordTarget(target);

  const difficultyScore =
    normalized.maxDifficulty <= 10 ? 3
      : normalized.maxDifficulty <= 20 ? 2
        : normalized.maxDifficulty <= 30 ? 1
          : 0;

  const volumeScore =
    normalized.minSearchVolume >= 5000 ? 3
      : normalized.minSearchVolume >= 1000 ? 2
        : normalized.minSearchVolume >= 500 ? 1
          : 0;

  return difficultyScore + volumeScore;
}

export function getKeywordSettingsWarning(target: KeywordTarget) {
  const normalized = normalizeKeywordTarget(target);
  if (getKeywordSettingsWarningScore(normalized) < 3) {
    return null;
  }

  return `This target is aggressive. BAM may need to lower volume below ${normalized.minSearchVolume} before it raises difficulty above ${normalized.maxDifficulty}.`;
}

export function getNextLowerKeywordVolumeRequirement(current: number) {
  const normalized = normalizeKeywordMinSearchVolume(current);
  return KEYWORD_VOLUME_RELAXATION_STEPS.find((step) => step < normalized) ?? null;
}

export function getNextHigherKeywordDifficultyAllowance(current: number) {
  const normalized = normalizeKeywordMaxDifficulty(current);
  return KEYWORD_DIFFICULTY_RELAXATION_STEPS.find((step) => step > normalized) ?? null;
}

export function buildKeywordTargetSequence(initialTarget: KeywordTarget) {
  const start = normalizeKeywordTarget(initialTarget);
  const sequence: KeywordTarget[] = [start];

  let current = start;
  while (true) {
    const nextVolume = getNextLowerKeywordVolumeRequirement(current.minSearchVolume);
    if (nextVolume === null) {
      break;
    }

    current = {
      ...current,
      minSearchVolume: nextVolume,
    };
    sequence.push(current);
  }

  while (true) {
    const nextDifficulty = getNextHigherKeywordDifficultyAllowance(current.maxDifficulty);
    if (nextDifficulty === null) {
      break;
    }

    current = {
      ...current,
      maxDifficulty: nextDifficulty,
    };
    sequence.push(current);
  }

  return sequence;
}

export function keywordMatchesTarget(
  keyword: {
    difficulty: number | null;
    searchVolume: number | null;
  },
  target: KeywordTarget,
) {
  const normalized = normalizeKeywordTarget(target);

  return (
    keyword.searchVolume !== null &&
    keyword.difficulty !== null &&
    keyword.searchVolume >= normalized.minSearchVolume &&
    keyword.difficulty <= normalized.maxDifficulty
  );
}

export function formatKeywordTarget(target: KeywordTarget) {
  const normalized = normalizeKeywordTarget(target);
  return `difficulty <= ${normalized.maxDifficulty}, volume >= ${normalized.minSearchVolume}`;
}

export function deriveKeywordTargetFromMetrics(
  keywords: KeywordMetric[],
  fallback: Partial<KeywordTarget> | null | undefined,
) {
  const normalizedFallback = normalizeKeywordTarget(fallback);
  const qualifyingKeywords = keywords.filter(
    (keyword) =>
      keyword.searchVolume !== null &&
      keyword.difficulty !== null &&
      Number.isFinite(keyword.searchVolume) &&
      Number.isFinite(keyword.difficulty),
  );

  if (qualifyingKeywords.length === 0) {
    return normalizedFallback;
  }

  return normalizeKeywordTarget({
    maxDifficulty: Math.max(...qualifyingKeywords.map((keyword) => keyword.difficulty ?? 0)),
    minSearchVolume: Math.min(...qualifyingKeywords.map((keyword) => keyword.searchVolume ?? 0)),
  });
}
