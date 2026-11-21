import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

describe("MobFlow bcrypt compatibility", () => {
  it("verifies a bcrypt hash using the same verifier used by Better Auth", async () => {
    const password = "MobFlow-preview-only-test-password";
    const hash = await bcrypt.hash(password, 10);
    const legacySupabasePrefix = hash.replace(/^\$2b\$/, "$2a$");

    await expect(bcrypt.compare(password, legacySupabasePrefix)).resolves.toBe(true);
    await expect(bcrypt.compare("wrong-password", legacySupabasePrefix)).resolves.toBe(false);
  });
});
