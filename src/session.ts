import { randomToken } from "./password.js";

export interface Session {
  token: string;
  user: string;
  createdAt: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h
const sessions = new Map<string, Session>();

export function createSession(user: string): Session {
  const now = Date.now();
  const s: Session = {
    token: randomToken(32),
    user,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  sessions.set(s.token, s);
  return s;
}

export function getSession(token: string | undefined): Session | null {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return s;
}

export function destroySession(token: string | undefined): void {
  if (token) sessions.delete(token);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export const SESSION_COOKIE = "dshl_session";
