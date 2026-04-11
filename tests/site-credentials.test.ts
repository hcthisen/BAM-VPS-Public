import { describe, expect, it } from "vitest";

import { encryptJson } from "../src/lib/security";
import { readWordPressApplicationPassword } from "../src/lib/site-credentials";

describe("site credentials", () => {
  it("reads encrypted WordPress application passwords before legacy plaintext", () => {
    const encrypted = encryptJson({ wordpressApplicationPassword: "encrypted-password" });

    expect(
      readWordPressApplicationPassword({
        wordpress_username: "editor",
        wordpress_application_password: "legacy-password",
        secrets_encrypted: encrypted,
      }),
    ).toBe("encrypted-password");
  });

  it("falls back to legacy plaintext WordPress application passwords", () => {
    expect(
      readWordPressApplicationPassword({
        wordpress_username: "editor",
        wordpress_application_password: "legacy-password",
        secrets_encrypted: null,
      }),
    ).toBe("legacy-password");
  });
});
