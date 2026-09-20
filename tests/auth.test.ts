import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { AuthStore, parseEncryptionKey } from "../src/server/auth-store.js";
import { AuthError, AuthService } from "../src/server/auth.js";
let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "kv-auth-"));
});
afterEach(async () => fs.rm(dir, { recursive: true, force: true }));
const key = () => crypto.randomBytes(32);
const service = async (k = key()) => {
  const st = new AuthStore(dir, k);
  await st.init();
  const a = new AuthService(st, { sessionSecret: "s".repeat(32) });
  return { st, a };
};
describe("encrypted auth store and lifecycle", () => {
  it("strictly parses 32-byte keys", () => {
    const k = key();
    expect(parseEncryptionKey(k.toString("hex"))).toEqual(k);
    expect(parseEncryptionKey(k.toString("base64"))).toEqual(k);
    expect(() => parseEncryptionKey("short")).toThrow();
  });
  it("bootstraps once, hashes passwords, and writes encrypted mode 0600 with fresh IVs", async () => {
    const { st, a } = await service();
    await a.bootstrap("Admin", "Very-strong-password-1");
    const raw1 = await fs.readFile(st.filePath, "utf8");
    expect(raw1).not.toContain("Very-strong-password-1");
    expect(st.snapshot().users[0].passwordHash).toMatch(/^\$2/);
    expect((await fs.stat(st.filePath)).mode & 0o777).toBe(0o600);
    await a.createUser("editor", "Another-strong-password-2");
    const raw2 = await fs.readFile(st.filePath, "utf8");
    expect(JSON.parse(raw1).iv).not.toBe(JSON.parse(raw2).iv);
    await a.bootstrap("Ignored", "Ignored-strong-password-3");
    expect(st.snapshot().users).toHaveLength(2);
  });
  it("fails closed on wrong key and tamper without replacing ciphertext", async () => {
    const { st, a } = await service();
    await a.bootstrap("admin", "Very-strong-password-1");
    const raw = await fs.readFile(st.filePath, "utf8");
    const wrong = new AuthStore(dir, key());
    await expect(wrong.init()).rejects.toThrow("startup aborted");
    expect(await fs.readFile(st.filePath, "utf8")).toBe(raw);
    const env = JSON.parse(raw);
    env.ciphertext = env.ciphertext.slice(0, -2) + "aa";
    await fs.writeFile(st.filePath, JSON.stringify(env));
    await expect(new AuthStore(dir, (st as any).key).init()).rejects.toThrow(
      "startup aborted",
    );
  });
  it("rejects normalized duplicates and guards last active admin", async () => {
    const { a } = await service();
    await a.bootstrap("Admin", "Very-strong-password-1");
    await expect(
      a.createUser("admin", "Another-strong-password-2"),
    ).rejects.toMatchObject({ status: 409 });
    const id = a.listUsers()[0].id;
    await expect(a.setStatus(id, false)).rejects.toMatchObject({ status: 409 });
    await expect(a.setRole(id, "user")).rejects.toMatchObject({ status: 409 });
  });
  it("creates stateful sessions and revokes on logout/reset/deactivation", async () => {
    const { a, st } = await service();
    await a.bootstrap("admin", "Very-strong-password-1");
    const l = await a.login("ADMIN", "Very-strong-password-1", "127.0.0.1");
    expect(l.token.split(".")).toHaveLength(3);
    expect(st.snapshot().sessions[0].revokedAt).toBeUndefined();
    await a.logout(st.snapshot().sessions[0].id);
    expect(st.snapshot().sessions[0].revokedAt).toBeTruthy();
    const u = await a.createUser("editor", "Another-strong-password-2");
    await a.login("editor", "Another-strong-password-2", "x");
    await a.resetPassword(u.id, "Replacement-password-3");
    expect(
      st.snapshot().sessions.find((x) => x.userId === u.id)?.revokedAt,
    ).toBeTruthy();
    await a.login("editor", "Replacement-password-3", "y");
    await a.setStatus(u.id, false);
    expect(
      st
        .snapshot()
        .sessions.filter((x) => x.userId === u.id)
        .every((x) => x.revokedAt),
    ).toBe(true);
  });
  it("generic failure and rate limit do not enumerate users", async () => {
    const { a } = await service();
    await a.bootstrap("admin", "Very-strong-password-1");
    for (const name of ["missing", "admin"])
      await expect(a.login(name, "wrong-password", "ip")).rejects.toMatchObject(
        { status: 401, message: "Invalid username or password" },
      );
    await expect(
      a.login("missing", "wrong-password", "ip"),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
