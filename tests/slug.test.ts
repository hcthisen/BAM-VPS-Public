import { describe, expect, it } from "vitest";

import { slugify } from "../src/lib/services/slug";

describe("slugify", () => {
  it("normalizes text for URLs", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });
});

