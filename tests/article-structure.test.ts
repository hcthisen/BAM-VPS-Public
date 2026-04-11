import { describe, expect, it } from "vitest";

import { enforceFinalWordsBeforeFaq, isFaqHeading, orderFinalWordsBeforeFaq } from "../src/lib/content/article-structure";

describe("article structure helpers", () => {
  it("moves Final Words before FAQ in outlines", () => {
    const ordered = orderFinalWordsBeforeFaq([
      { heading: "Intro", type: "intro" },
      { heading: "FAQ", type: "faq" },
      { heading: "Final Words", type: "conclusion" },
    ]);

    expect(ordered.map((section) => section.heading)).toEqual(["Intro", "Final Words", "FAQ"]);
  });

  it("moves Final Words before FAQ in markdown", () => {
    const markdown = [
      "Intro text",
      "## Main Section",
      "Body",
      "## FAQ",
      "### Question?",
      "Answer",
      "## Final Words",
      "Closing thought",
    ].join("\n");

    const fixed = enforceFinalWordsBeforeFaq(markdown);

    expect(fixed.indexOf("## Final Words")).toBeLessThan(fixed.indexOf("## FAQ"));
    expect(fixed.trim().endsWith("Answer")).toBe(true);
  });

  it("recognizes FAQ headings so image planning can skip them", () => {
    expect(isFaqHeading("FAQ")).toBe(true);
    expect(isFaqHeading("Frequently Asked Questions")).toBe(true);
    expect(isFaqHeading("Final Words")).toBe(false);
  });
});
