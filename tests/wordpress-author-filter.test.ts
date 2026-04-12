import { describe, expect, it } from "vitest";

import {
  formatWordPressRoleLabel,
  getPreferredWordPressRole,
  isEligibleWordPressAuthor,
} from "../src/lib/providers/wordpress";

describe("WordPress author filtering", () => {
  it("allows publish-capable roles", () => {
    expect(isEligibleWordPressAuthor({ roles: ["author"] })).toBe(true);
    expect(isEligibleWordPressAuthor({ roles: ["editor"] })).toBe(true);
    expect(isEligibleWordPressAuthor({ roles: ["administrator"] })).toBe(true);
    expect(isEligibleWordPressAuthor({ roles: ["content_writer"] })).toBe(true);
  });

  it("rejects low-privilege roles", () => {
    expect(isEligibleWordPressAuthor({ roles: ["subscriber"] })).toBe(false);
    expect(isEligibleWordPressAuthor({ roles: ["contributor"] })).toBe(false);
  });

  it("normalizes role labels for display", () => {
    expect(getPreferredWordPressRole(["seo_editor", "subscriber"])).toBe("seo_editor");
    expect(formatWordPressRoleLabel("seo_editor")).toBe("Seo Editor");
  });
});
