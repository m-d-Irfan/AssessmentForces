import { UserRole } from "@prisma/client";
import { hashPassword, verifyPassword } from "../../src/modules/auth/password.service.js";
import {
  createOpaqueToken,
  hashOpaqueToken,
  signAccessToken,
  verifyAccessToken,
} from "../../src/modules/auth/token.service.js";
import { decryptPrivateData, encryptPrivateData } from "../../src/shared/security/private-data.js";

describe("security primitives", () => {
  it("encrypts private notes with randomized authenticated encryption", () => {
    const first = encryptPrivateData("confidential HR note");
    const second = encryptPrivateData("confidential HR note");
    expect(first).not.toBe(second);
    expect(first).not.toContain("confidential HR note");
    expect(decryptPrivateData(first)).toBe("confidential HR note");
  });

  it("rejects tampered encrypted private notes", () => {
    const encrypted = encryptPrivateData("protected");
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;
    expect(() => decryptPrivateData(tampered)).toThrow();
  });

  it("hashes and verifies passwords without deterministic hashes", async () => {
    const first = await hashPassword("A-strong-password-123!");
    const second = await hashPassword("A-strong-password-123!");
    expect(first).not.toBe(second);
    await expect(verifyPassword("A-strong-password-123!", first)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", first)).resolves.toBe(false);
    await expect(verifyPassword("anything", "invalid-hash")).resolves.toBe(false);
  });

  it("creates opaque tokens and stable non-reversible token hashes", () => {
    const token = createOpaqueToken(32);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(hashOpaqueToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
    expect(hashOpaqueToken(token)).not.toContain(token);
  });

  it("signs and verifies access-token claims and rejects invalid tokens", async () => {
    const token = await signAccessToken({
      userId: "user-1",
      role: UserRole.RECRUITER,
      sessionId: "session-1",
    });
    await expect(verifyAccessToken(token)).resolves.toMatchObject({
      userId: "user-1",
      role: UserRole.RECRUITER,
      sessionId: "session-1",
    });
    await expect(verifyAccessToken(`${token}tampered`)).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_ACCESS_TOKEN",
    });
  });
});
