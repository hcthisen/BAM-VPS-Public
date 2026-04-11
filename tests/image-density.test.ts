import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMAGE_DENSITY_PCT,
  getBodyImageCountForH2s,
  normalizeImageDensityPct,
  selectHeadingsForImageDensity,
} from "../src/lib/content/image-density";

describe("image density helpers", () => {
  it("normalizes invalid values to the default density", () => {
    expect(normalizeImageDensityPct("50")).toBe(50);
    expect(normalizeImageDensityPct("invalid")).toBe(DEFAULT_IMAGE_DENSITY_PCT);
    expect(normalizeImageDensityPct(10, 25)).toBe(25);
  });

  it("computes body image counts from the selected density", () => {
    expect(getBodyImageCountForH2s(6, 100)).toBe(6);
    expect(getBodyImageCountForH2s(6, 75)).toBe(5);
    expect(getBodyImageCountForH2s(6, 50)).toBe(3);
    expect(getBodyImageCountForH2s(6, 30)).toBe(2);
    expect(getBodyImageCountForH2s(6, 25)).toBe(2);
  });

  it("selects an evenly distributed subset of H2 headings", () => {
    const headings = ["One", "Two", "Three", "Four", "Five", "Six"];

    expect(selectHeadingsForImageDensity(headings, 100)).toEqual(headings);
    expect(selectHeadingsForImageDensity(headings, 50)).toEqual(["Two", "Four", "Six"]);
    expect(selectHeadingsForImageDensity(headings, 30)).toEqual(["Two", "Five"]);
    expect(selectHeadingsForImageDensity(headings, 25)).toEqual(["Two", "Five"]);
  });

  it("still yields one section image for short articles at lower densities", () => {
    expect(selectHeadingsForImageDensity(["Only Section"], 25)).toEqual(["Only Section"]);
    expect(selectHeadingsForImageDensity(["First", "Second", "Third"], 75)).toEqual(["First", "Third"]);
  });
});
