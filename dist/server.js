import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig, getService, setAdmin, hasAdmin, checkAdmin, } from "./config.js";
import { createSession, getSession, destroySession, parseCookies, SESSION_COOKIE, } from "./session.js";
import { serviceManager } from "./service-manager.js";
import { listVersions, installVersion, activateVersion, fetchAvailableVersions } from "./versions.js";
import { sanitizeServiceInput } from "./service-input.js";
import { checkSystemctlAccess } from "./systemd.js";
const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..", "web");
function requireAuth(req, res, next) {
    const cookies = parseCookies(req.headers.cookie);
    const sess = getSession(cookies[SESSION_COOKIE]);
    if (!sess) {
        res.status(401).json({ error: "unauthorized" });
        return;
    }
    req.session = sess;
    next();
}
export function createApp() {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    // ---- auth ----
    app.post("/api/login", (req, res) => {
        const { username, password } = req.body ?? {};
        if (typeof username !== "string" || typeof password !== "string") {
            res.status(400).json({ error: "missing credentials" });
            return;
        }
        if (!checkAdmin(username, password)) {
            res.status(401).json({ error: "invalid credentials" });
            return;
        }
        const sess = createSession(username);
        res.cookie(SESSION_COOKIE, sess.token, {
            httpOnly: true,
            sameSite: "lax",
            secure: false, // TLS terminates at the reverse proxy; cookie rides https upstream
            maxAge: 12 * 60 * 60 * 1000,
            path: "/",
        });
        res.json({ ok: true, user: username });
    });
    app.post("/api/logout", (req, res) => {
        const cookies = parseCookies(req.headers.cookie);
        destroySession(cookies[SESSION_COOKIE]);
        res.clearCookie(SESSION_COOKIE, { path: "/" });
        res.json({ ok: true });
    });
    app.get("/api/me", requireAuth, (req, res) => {
        const sess = req.session;
        res.json({ user: sess.user, systemctlOk: (app.locals.systemctlOk ?? false) });
    });
    app.post("/api/password", requireAuth, (req, res) => {
        const { current, next } = req.body ?? {};
        const sess = req.session;
        if (!checkAdmin(sess.user, String(current ?? ""))) {
            res.status(400).json({ error: "current password incorrect" });
            return;
        }
        if (String(next ?? "").length < 8) {
            res.status(400).json({ error: "new password must be at least 8 characters" });
            return;
        }
        setAdmin(sess.user, String(next));
        res.json({ ok: true });
    });
    // ---- config ----
    app.get("/api/config", requireAuth, (_req, res) => {
        const cfg = loadConfig();
        // Never leak anything sensitive; config is non-secret.
        res.json(cfg);
    });
    app.patch("/api/config", requireAuth, (req, res) => {
        const cfg = loadConfig();
        const body = req.body ?? {};
        const next = {
            ...cfg,
            launchHost: String(body.launchHost ?? cfg.launchHost),
            dshHost: String(body.dshHost ?? cfg.dshHost),
            systemDshPath: String(body.systemDshPath ?? cfg.systemDshPath),
        };
        saveConfig(next);
        res.json({ ok: true, config: next });
    });
    // ---- services ----
    app.get("/api/services", requireAuth, async (_req, res) => {
        const cfg = loadConfig();
        const statuses = await Promise.all(cfg.services.map((s) => serviceManager.getStatus(s)));
        res.json({ services: statuses });
    });
    app.post("/api/services", requireAuth, async (req, res) => {
        const cfg = loadConfig();
        let svc;
        try {
            svc = sanitizeServiceInput(req.body);
        }
        catch (e) {
            res.status(400).json({ error: e.message });
            return;
        }
        cfg.services.push(svc);
        saveConfig(cfg);
        const inst = await serviceManager.installUnit(svc);
        res.json({ ok: true, service: svc, unitInstalled: inst.installed });
    });
    app.get("/api/services/:id", requireAuth, async (req, res) => {
        const cfg = loadConfig();
        const svc = getService(cfg, req.params.id);
        if (!svc) {
            res.status(404).json({ error: "not found" });
            return;
        }
        res.json(await serviceManager.getStatus(svc));
    });
    app.put("/api/services/:id", requireAuth, async (req, res) => {
        const cfg = loadConfig();
        const idx = cfg.services.findIndex((s) => s.id === req.params.id);
        if (idx < 0) {
            res.status(404).json({ error: "not found" });
            return;
        }
        let svc;
        try {
            svc = sanitizeServiceInput(req.body, cfg.services[idx]);
        }
        catch (e) {
            res.status(400).json({ error: e.message });
            return;
        }
        cfg.services[idx] = svc;
        saveConfig(cfg);
        const inst = await serviceManager.installUnit(svc);
        res.json({ ok: true, service: svc, unitInstalled: inst.installed });
    });
    app.delete("/api/services/:id", requireAuth, async (req, res) => {
        const cfg = loadConfig();
        const svc = getService(cfg, req.params.id);
        if (!svc) {
            res.status(404).json({ error: "not found" });
            return;
        }
        await serviceManager.removeUnitForService(svc.id).catch(() => { });
        cfg.services = cfg.services.filter((s) => s.id !== req.params.id);
        saveConfig(cfg);
        res.json({ ok: true });
    });
    app.post("/api/services/:id/start", requireAuth, async (req, res) => {
        const cfg = loadConfig();
        const svc = getService(cfg, req.params.id);
        if (!svc)
            return void res.status(404).json({ error: "not found" });
        try {
            await serviceManager.start(svc, true);
            res.json({ ok: true });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post("/api/services/:id/stop", requireAuth, async (req, res) => {
        const cfg = loadConfig();
        const svc = getService(cfg, req.params.id);
        if (!svc)
            return void res.status(404).json({ error: "not found" });
        try {
            await serviceManager.stop(svc, true);
            res.json({ ok: true });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post("/api/services/:id/restart", requireAuth, async (req, res) => {
        const cfg = loadConfig();
        const svc = getService(cfg, req.params.id);
        if (!svc)
            return void res.status(404).json({ error: "not found" });
        try {
            await serviceManager.restart(svc);
            res.json({ ok: true });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post("/api/services/:id/token", requireAuth, async (req, res) => {
        const cfg = loadConfig();
        const svc = getService(cfg, req.params.id);
        if (!svc)
            return void res.status(404).json({ error: "not found" });
        const st = await serviceManager.getStatus(svc);
        res.json({ token: st.token, webLink: st.webLink });
    });
    app.get("/api/services/:id/logs", requireAuth, async (req, res) => {
        const cfg = loadConfig();
        const svc = getService(cfg, req.params.id);
        if (!svc)
            return void res.status(404).json({ error: "not found" });
        const since = String(req.query.since ?? "1 hour ago");
        const lines = Math.min(2000, Number(req.query.lines ?? 400));
        const logs = await serviceManager.getLogs(svc, since, lines);
        res.json({ lines: logs });
    });
    // SSE log stream
    app.get("/api/services/:id/stream", requireAuth, async (req, res) => {
        const cfg = loadConfig();
        const svc = getService(cfg, req.params.id);
        if (!svc)
            return void res.status(404).end();
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        let lastCount = 0;
        const send = async () => {
            const lines = await serviceManager.getLogs(svc, "since boot", 600);
            if (lines.length < lastCount)
                lastCount = 0;
            const fresh = lines.slice(lastCount);
            lastCount = lines.length;
            if (fresh.length)
                res.write(`data: ${JSON.stringify(fresh)}\n\n`);
        };
        await send();
        const t = setInterval(send, 2000);
        req.on("close", () => clearInterval(t));
    });
    // ---- versions ----
    app.get("/api/versions", requireAuth, async (_req, res) => {
        const local = listVersions();
        res.json(local);
    });
    app.get("/api/versions/available", requireAuth, async (_req, res) => {
        const versions = await fetchAvailableVersions();
        res.json({ versions });
    });
    app.post("/api/versions/install", requireAuth, async (req, res) => {
        const version = String(req.body?.version ?? "").trim();
        if (!version)
            return void res.status(400).json({ error: "version required" });
        const r = await installVersion(version);
        res.status(r.ok ? 200 : 500).json(r);
    });
    app.post("/api/versions/activate", requireAuth, async (req, res) => {
        const version = String(req.body?.version ?? "system");
        try {
            activateVersion(version);
            // Rebuild every unit so services that inherit the active version pick it
            // up; they take effect on the next restart.
            const rebuilt = await serviceManager.installAllUnits();
            res.json({ ok: true, activeVersion: version, rebuilt });
        }
        catch (e) {
            res.status(400).json({ error: e.message });
        }
    });
    // ---- static UI ----
    app.get("/healthz", (_req, res) => res.json({ ok: true }));
    app.use(express.static(webDir, { index: "index.html" }));
    app.get("*", (req, res, next) => {
        if (req.path.startsWith("/api/"))
            return next();
        const idx = path.join(webDir, "index.html");
        if (fs.existsSync(idx))
            res.sendFile(idx);
        else
            res.status(404).send("UI not built");
    });
    return app;
}
export async function bootstrapState(app) {
    app.locals.systemctlOk = await checkSystemctlAccess();
    app.locals.hasAdmin = hasAdmin();
    serviceManager.startWatchdog(5000);
}
