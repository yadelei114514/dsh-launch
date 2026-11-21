import { randomToken } from "./password.js";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h
const sessions = new Map();
export function createSession(user) {
    const now = Date.now();
    const s = {
        token: randomToken(32),
        user,
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS,
    };
    sessions.set(s.token, s);
    return s;
}
export function getSession(token) {
    if (!token)
        return null;
    const s = sessions.get(token);
    if (!s)
        return null;
    if (Date.now() > s.expiresAt) {
        sessions.delete(token);
        return null;
    }
    return s;
}
export function destroySession(token) {
    if (token)
        sessions.delete(token);
}
export function parseCookies(header) {
    const out = {};
    if (!header)
        return out;
    for (const part of header.split(";")) {
        const idx = part.indexOf("=");
        if (idx < 0)
            continue;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k)
            out[k] = decodeURIComponent(v);
    }
    return out;
}
export const SESSION_COOKIE = "dshl_session";
