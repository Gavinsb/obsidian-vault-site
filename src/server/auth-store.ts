import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type UserRole = "admin" | "user";
export interface AuthUser {
  id: string;
  username: string;
  usernameNormalized: string;
  role: UserRole;
  passwordHash: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  passwordChangedAt: string;
}
export interface AuthSession {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}
export interface AuthState {
  version: 1;
  users: AuthUser[];
  sessions: AuthSession[];
}
interface Envelope {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

export function parseEncryptionKey(value: string): Buffer {
  let key: Buffer;
  if (/^[a-f0-9]{64}$/i.test(value)) key = Buffer.from(value, "hex");
  else if (/^[A-Za-z0-9+/]{43}=$/.test(value))
    key = Buffer.from(value, "base64");
  else
    throw new Error(
      "KV_AUTH_ENCRYPTION_KEY must be exactly 32 bytes encoded as hex or base64",
    );
  if (key.length !== 32)
    throw new Error("KV_AUTH_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

export class AuthStore {
  readonly filePath: string;
  private state: AuthState = { version: 1, users: [], sessions: [] };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly dataDir: string,
    private readonly key: Buffer,
  ) {
    this.filePath = path.join(dataDir, "auth.enc");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    try {
      this.state = this.decrypt(await fs.readFile(this.filePath, "utf8"));
    } catch (e: any) {
      if (e?.code !== "ENOENT")
        throw new Error(
          "Encrypted auth store could not be opened; startup aborted",
        );
    }
  }
  snapshot(): AuthState {
    return structuredClone(this.state);
  }
  async update<T>(fn: (draft: AuthState) => T | Promise<T>): Promise<T> {
    const run = async () => {
      const draft = this.snapshot();
      const result = await fn(draft);
      await this.persist(draft);
      this.state = draft;
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  private decrypt(raw: string): AuthState {
    const env = JSON.parse(raw) as Envelope;
    if (env.version !== 1 || env.algorithm !== "aes-256-gcm")
      throw new Error("unsupported auth store");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(env.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(env.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(env.ciphertext, "base64")),
      decipher.final(),
    ]);
    const state = JSON.parse(plain.toString("utf8")) as AuthState;
    if (
      state.version !== 1 ||
      !Array.isArray(state.users) ||
      !Array.isArray(state.sessions)
    )
      throw new Error("invalid auth state");
    return state;
  }
  private encrypt(state: AuthState): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(state), "utf8"),
      cipher.final(),
    ]);
    return JSON.stringify({
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    } satisfies Envelope);
  }
  private async persist(state: AuthState): Promise<void> {
    const tmp = `${this.filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
    const data = this.encrypt(state);
    let fh;
    try {
      fh = await fs.open(tmp, "wx", 0o600);
      await fh.writeFile(data, "utf8");
      await fh.sync();
      await fh.close();
      fh = undefined;
      try {
        await fs.copyFile(this.filePath, `${this.filePath}.bak`);
        await fs.chmod(`${this.filePath}.bak`, 0o600);
      } catch (e: any) {
        if (e?.code !== "ENOENT") throw e;
      }
      await fs.rename(tmp, this.filePath);
      await fs.chmod(this.filePath, 0o600);
      const dir = await fs.open(this.dataDir, "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } finally {
      if (fh) await fh.close().catch(() => {});
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  }
}
