import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { NextFunction, Request, Response } from "express";
import { AuthStore, type AuthUser, type UserRole } from "./auth-store.js";

declare global {
  namespace Express {
    interface Request {
      auth?: { user: AuthUser; sessionId: string };
    }
  }
}
const COOKIE = "kv_session";
const normalize = (s: string) => s.trim().normalize("NFKC").toLowerCase();
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const safe = (u: AuthUser) => ({
  id: u.id,
  username: u.username,
  role: u.role,
  active: u.active,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
  passwordChangedAt: u.passwordChangedAt,
});
export type SafeUser = ReturnType<typeof safe>;

export interface AuthOptions {
  sessionSecret: string;
  ttlHours?: number;
  secureCookies?: boolean;
  allowedOrigin?: string;
}
export class AuthService {
  private attempts = new Map<string, { count: number; until: number }>();
  readonly ttlMs: number;
  constructor(
    readonly store: AuthStore,
    private opts: AuthOptions,
  ) {
    if (Buffer.byteLength(opts.sessionSecret) < 32)
      throw new Error("KV_SESSION_SECRET must contain at least 32 bytes");
    this.ttlMs = (opts.ttlHours ?? 12) * 3600000;
  }
  async bootstrap(username: string, password?: string): Promise<void> {
    if (this.store.snapshot().users.length) {
      if (password)
        console.warn(
          "INITIAL_ADMIN_PASSWORD ignored because auth users already exist; remove it from persistent configuration.",
        );
      return;
    }
    if (!password)
      throw new Error(
        "INITIAL_ADMIN_PASSWORD is required when the auth store has no users",
      );
    this.validatePassword(password);
    await this.store.update(async (s) => {
      if (s.users.length) return;
      const now = new Date().toISOString();
      s.users.push({
        id: crypto.randomUUID(),
        username: username.trim() || "admin",
        usernameNormalized: normalize(username || "admin"),
        role: "admin",
        passwordHash: await bcrypt.hash(password, 12),
        active: true,
        createdAt: now,
        updatedAt: now,
        passwordChangedAt: now,
      });
    });
  }
  middleware = async (req: Request, _res: Response, next: NextFunction) => {
    const token = parseCookies(req.headers.cookie ?? "")[COOKIE];
    if (!token) return next();
    const payload = this.verify(token);
    if (!payload) return next();
    const state = this.store.snapshot();
    const session = state.sessions.find(
      (s) =>
        s.id === payload.sid &&
        s.userId === payload.uid &&
        !s.revokedAt &&
        Date.parse(s.expiresAt) > Date.now(),
    );
    const user = state.users.find((u) => u.id === payload.uid && u.active);
    if (session && user && user.role === payload.role)
      req.auth = { user, sessionId: session.id };
    next();
  };
  requireUser = (req: Request, res: Response, next: NextFunction) =>
    req.auth
      ? next()
      : res.status(401).json({ error: "authentication_required" });
  requireAdmin = (req: Request, res: Response, next: NextFunction) =>
    !req.auth
      ? res.status(401).json({ error: "authentication_required" })
      : req.auth.user.role !== "admin"
        ? res.status(403).json({ error: "admin_required" })
        : next();
  originGuard = (req: Request, res: Response, next: NextFunction) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || !req.auth)
      return next();
    const origin = req.get("origin");
    const expected = this.opts.allowedOrigin;
    if (origin && expected && origin !== expected)
      return res.status(403).json({ error: "origin_rejected" });
    if (origin && !expected) {
      try {
        if (new URL(origin).host !== req.get("host"))
          return res.status(403).json({ error: "origin_rejected" });
      } catch {
        return res.status(403).json({ error: "origin_rejected" });
      }
    }
    next();
  };
  async login(
    username: string,
    password: string,
    ip: string,
  ): Promise<{ token: string; user: SafeUser }> {
    const key = `${ip}|${normalize(username)}`;
    const state = this.attempts.get(key);
    if (state && state.until > Date.now())
      throw new AuthError(429, "login_temporarily_limited");
    const user = this.store
      .snapshot()
      .users.find((u) => u.usernameNormalized === normalize(username));
    const valid =
      !!user &&
      user.active &&
      (await bcrypt.compare(password, user.passwordHash));
    if (!valid) {
      const count = (state?.count ?? 0) + 1;
      this.attempts.set(key, {
        count,
        until: Date.now() + Math.min(30000, count * count * 250),
      });
      throw new AuthError(401, "Invalid username or password");
    }
    this.attempts.delete(key);
    const sid = crypto.randomUUID();
    const exp = new Date(Date.now() + this.ttlMs).toISOString();
    await this.store.update((s) => {
      s.sessions.push({
        id: sid,
        userId: user.id,
        createdAt: new Date().toISOString(),
        expiresAt: exp,
      });
    });
    return {
      token: this.sign({
        sid,
        uid: user.id,
        role: user.role,
        exp: Math.floor(Date.parse(exp) / 1000),
        iat: Math.floor(Date.now() / 1000),
      }),
      user: safe(user),
    };
  }
  cookie(token: string): string {
    return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(this.ttlMs / 1000)}${this.opts.secureCookies ? "; Secure" : ""}`;
  }
  clearCookie(): string {
    return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${this.opts.secureCookies ? "; Secure" : ""}`;
  }
  async logout(id: string) {
    await this.store.update((s) => {
      const x = s.sessions.find((v) => v.id === id);
      if (x) x.revokedAt = new Date().toISOString();
    });
  }
  listUsers(): SafeUser[] {
    return this.store.snapshot().users.map(safe);
  }
  async createUser(
    username: string,
    password: string,
    role: UserRole = "user",
  ): Promise<SafeUser> {
    this.validateUsername(username);
    this.validatePassword(password);
    return this.store.update(async (s) => {
      const n = normalize(username);
      if (s.users.some((u) => u.usernameNormalized === n))
        throw new AuthError(409, "username_exists");
      const now = new Date().toISOString();
      const u: AuthUser = {
        id: crypto.randomUUID(),
        username: username.trim(),
        usernameNormalized: n,
        role,
        passwordHash: await bcrypt.hash(password, 12),
        active: true,
        createdAt: now,
        updatedAt: now,
        passwordChangedAt: now,
      };
      s.users.push(u);
      return safe(u);
    });
  }
  async resetPassword(id: string, password: string) {
    this.validatePassword(password);
    await this.store.update(async (s) => {
      const u = s.users.find((x) => x.id === id);
      if (!u) throw new AuthError(404, "user_not_found");
      const now = new Date().toISOString();
      u.passwordHash = await bcrypt.hash(password, 12);
      u.passwordChangedAt = now;
      u.updatedAt = now;
      for (const x of s.sessions)
        if (x.userId === id && !x.revokedAt) x.revokedAt = now;
    });
  }
  async setStatus(id: string, active: boolean) {
    await this.store.update((s) => {
      const u = s.users.find((x) => x.id === id);
      if (!u) throw new AuthError(404, "user_not_found");
      if (
        !active &&
        u.role === "admin" &&
        u.active &&
        s.users.filter((x) => x.active && x.role === "admin").length <= 1
      )
        throw new AuthError(409, "last_active_admin");
      u.active = active;
      u.updatedAt = new Date().toISOString();
      if (!active)
        for (const x of s.sessions)
          if (x.userId === id && !x.revokedAt) x.revokedAt = u.updatedAt;
    });
  }
  async setRole(id: string, role: UserRole) {
    await this.store.update((s) => {
      const u = s.users.find((x) => x.id === id);
      if (!u) throw new AuthError(404, "user_not_found");
      if (
        role !== "admin" &&
        u.role === "admin" &&
        u.active &&
        s.users.filter((x) => x.active && x.role === "admin").length <= 1
      )
        throw new AuthError(409, "last_active_admin");
      u.role = role;
      u.updatedAt = new Date().toISOString();
      for (const x of s.sessions)
        if (x.userId === id && !x.revokedAt) x.revokedAt = u.updatedAt;
    });
  }
  private validateUsername(v: string) {
    if (!/^[\p{L}\p{N}_.-]{3,64}$/u.test(v.trim()))
      throw new AuthError(422, "invalid_username");
  }
  private validatePassword(v: string) {
    if (v.length < 12 || Buffer.byteLength(v) > 1024)
      throw new AuthError(422, "password_must_be_at_least_12_characters");
  }
  private sign(p: object) {
    const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const d = `${h}.${b64(JSON.stringify(p))}`;
    return `${d}.${crypto.createHmac("sha256", this.opts.sessionSecret).update(d).digest("base64url")}`;
  }
  private verify(t: string): any | null {
    const a = t.split(".");
    if (a.length !== 3) return null;
    const d = `${a[0]}.${a[1]}`;
    const sig = crypto
      .createHmac("sha256", this.opts.sessionSecret)
      .update(d)
      .digest();
    let got;
    try {
      got = Buffer.from(a[2], "base64url");
    } catch {
      return null;
    }
    if (got.length !== sig.length || !crypto.timingSafeEqual(got, sig))
      return null;
    try {
      const p = JSON.parse(Buffer.from(a[1], "base64url").toString());
      return p.exp > Date.now() / 1000 ? p : null;
    } catch {
      return null;
    }
  }
}
export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function parseCookies(h: string): Record<string, string> {
  return Object.fromEntries(
    h
      .split(";")
      .map((x) => x.trim().split("="))
      .filter((x) => x.length === 2)
      .map(([k, v]) => [k, decodeURIComponent(v)]),
  );
}
