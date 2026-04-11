export const IMAGE_DENSITY_OPTIONS = [100, 75, 50, 30, 25] as const;

export type ImageDensityPct = (typeof IMAGE_DENSITY_OPTIONS)[number];

export const DEFAULT_IMAGE_DENSITY_PCT: ImageDensityPct = 100;

export const IMAGE_DENSITY_OPTION_LABELS: Record<ImageDensityPct, string> = {
  100: "100% - every H2",
  75: "75% - about 3 images per 4 H2s",
  50: "50% - about every 2nd H2",
  30: "30% - about every 3rd to 4th H2",
  25: "25% - about every 4th H2",
};

export function normalizeImageDensityPct(
  value: unknown,
  fallback: ImageDensityPct = DEFAULT_IMAGE_DENSITY_PCT,
): ImageDensityPct {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? fallback), 10);

  return (IMAGE_DENSITY_OPTIONS as readonly number[]).includes(parsed)
    ? (parsed as ImageDensityPct)
    : fallback;
}

export function getBodyImageCountForH2s(h2Count: number, densityPct: ImageDensityPct) {
  if (h2Count <= 0) {
    return 0;
  }

  return Math.max(1, Math.min(h2Count, Math.round((h2Count * densityPct) / 100)));
}

export function selectHeadingsForImageDensity(headings: string[], densityPct: ImageDensityPct) {
  const desiredCount = getBodyImageCountForH2s(headings.length, densityPct);
  if (desiredCount === 0) {
    return [];
  }

  const used = new Set<number>();
  const selectedIndices: number[] = [];

  for (let slotIndex = 0; slotIndex < desiredCount; slotIndex += 1) {
    let index = Math.round((((slotIndex + 0.5) * headings.length) / desiredCount) - 0.5);
    index = Math.max(0, Math.min(headings.length - 1, index));

    if (used.has(index)) {
      let offset = 1;
      while (index - offset >= 0 || index + offset < headings.length) {
        const left = index - offset;
        if (left >= 0 && !used.has(left)) {
          index = left;
          break;
        }

        const right = index + offset;
        if (right < headings.length && !used.has(right)) {
          index = right;
          break;
        }

        offset += 1;
      }
    }

    if (!used.has(index)) {
      used.add(index);
      selectedIndices.push(index);
    }
  }

  selectedIndices.sort((left, right) => left - right);
  return selectedIndices.map((index) => headings[index]);
}
