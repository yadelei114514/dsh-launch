import { EventEmitter } from "node:events";
import { loadConfig, } from "./config.js";
import { journalLines, systemctl, systemctlShow, unitName, writeUnit, removeUnit, systemUnitExists, } from "./systemd.js";
import { resolveDshExec, listVersions } from "./versions.js";
const TOKEN_RE = /https?:\/\/[^\s/]+(?::\d+)?\/?\?token=([A-Za-z0-9_\-]+)/;
export class ServiceManager extends EventEmitter {
    tokens = new Map();
    backoff = new Map();
    timers = new Map();
    watched = new Map(); // id -> journal cursor marker (last line count)
    getBackoff(id) {
        if (!this.backoff.has(id)) {
            this.backoff.set(id, { consecutiveFailures: 0, paused: false, lastStartAt: 0 });
        }
        return this.backoff.get(id);
    }
    /** Reset pause/failure counters when the user acts manually. */
    resetBackoff(id) {
        const b = this.getBackoff(id);
        b.consecutiveFailures = 0;
        b.paused = false;
    }
    cfg() {
        return loadConfig();
    }
    /**
     * Resolve the dsh executable for a service. A per-service dshVersion takes
     * precedence; "inherit" (or empty) falls back to the globally active version.
     */
    resolveServiceExec(svc, cfg, activeVersion) {
        const key = !svc.dshVersion || svc.dshVersion === "inherit" ? activeVersion : svc.dshVersion;
        return resolveDshExec(key, cfg.systemDshPath);
    }
    async installAllUnits() {
        const cfg = this.cfg();
        const { activeVersion } = listVersions();
        const out = [];
        for (const svc of cfg.services) {
            const dshExec = this.resolveServiceExec(svc, cfg, activeVersion);
            const r = await writeUnit(svc, dshExec);
            out.push({ id: svc.id, installed: r.installed, name: r.name });
        }
        return out;
    }
    async installUnit(svc) {
        const cfg = this.cfg();
        const { activeVersion } = listVersions();
        const dshExec = this.resolveServiceExec(svc, cfg, activeVersion);
        const r = await writeUnit(svc, dshExec);
        return { installed: r.installed, name: r.name };
    }
    /** Remove a service's unit entirely (stop + disable + delete). */
    async removeUnitForService(svcId) {
        await removeUnit(svcId);
    }
    /** Extract token from journal lines belonging to the current run. */
    extractToken(lines) {
        for (let i = lines.length - 1; i >= 0; i--) {
            const m = TOKEN_RE.exec(lines[i]);
            if (m)
                return m[1];
        }
        return null;
    }
    buildWebLink(token) {
        if (!token)
            return null;
        const cfg = this.cfg();
        const host = cfg.dshHost || "dsh.example.com";
        return `https://${host}/?token=${token}`;
    }
    async getStatus(svc) {
        const name = unitName(svc.id);
        const b = this.getBackoff(svc.id);
        let sdState = "unknown";
        let subState = "unknown";
        let pid = null;
        let mem = null;
        let startedAt = null;
        let installed = systemUnitExists(name);
        if (installed) {
            const props = await systemctlShow(name, ["ActiveState", "SubState", "MainPID", "MemoryCurrent", "ExecMainStartTimestamp"]);
            sdState = props.ActiveState || "unknown";
            subState = props.SubState || "unknown";
            pid = props.MainPID && props.MainPID !== "0" ? Number(props.MainPID) : null;
            mem = props.MemoryCurrent && props.MemoryCurrent !== "[not set]" ? Number(props.MemoryCurrent) : null;
            startedAt = props.ExecMainStartTimestamp || null;
        }
        let state;
        if (b.paused)
            state = "paused";
        else if (sdState === "active")
            state = "running";
        else if (sdState === "activating")
            state = "activating";
        else if (sdState === "deactivating")
            state = "deactivating";
        else if (sdState === "failed")
            state = "failed";
        else if (sdState === "inactive")
            state = "stopped";
        else
            state = "unknown";
        // Fetch token from journal when running.
        let token = null;
        if (state === "running") {
            const lines = await journalLines(name, "since boot", 600);
            token = this.extractToken(lines);
            if (token)
                this.tokens.set(svc.id, token);
            else
                token = this.tokens.get(svc.id) ?? null;
        }
        else {
            token = this.tokens.get(svc.id) ?? null;
        }
        return {
            id: svc.id,
            name: svc.name,
            profile: svc.profile,
            state,
            systemdState: sdState,
            subState,
            pid,
            memoryBytes: mem,
            startedAt,
            token,
            webLink: this.buildWebLink(token),
            restartCount: b.consecutiveFailures,
            paused: b.paused,
            unitInstalled: installed,
            dshVersion: svc.dshVersion,
            lastError: state === "failed" ? "unit entered failed state" : null,
        };
    }
    async start(svc, manual = true) {
        if (manual)
            this.resetBackoff(svc.id);
        const name = unitName(svc.id);
        if (!systemUnitExists(name)) {
            const r = await this.installUnit(svc);
            if (!r.installed)
                throw new Error("unit not installed (needs sudo/root)");
        }
        const cur = await systemctlShow(name, ["ActiveState"]);
        if (cur.ActiveState === "active")
            return;
        const r = await systemctl("start", name);
        if (r.code !== 0)
            throw new Error(r.stderr || "systemctl start failed");
        this.getBackoff(svc.id).lastStartAt = Date.now();
    }
    async stop(svc, manual = true) {
        if (manual)
            this.resetBackoff(svc.id);
        const name = unitName(svc.id);
        if (!systemUnitExists(name))
            return;
        const r = await systemctl("stop", name);
        if (r.code !== 0)
            throw new Error(r.stderr || "systemctl stop failed");
    }
    async restart(svc) {
        this.resetBackoff(svc.id);
        const name = unitName(svc.id);
        if (!systemUnitExists(name)) {
            await this.start(svc, true);
            return;
        }
        // Re-write unit so config changes take effect, then restart.
        await this.installUnit(svc);
        const r = await systemctl("restart", name);
        if (r.code !== 0)
            throw new Error(r.stderr || "systemctl restart failed");
    }
    async getLogs(svc, since = "1 hour ago", lines = 400) {
        return journalLines(unitName(svc.id), since, lines);
    }
    /**
     * Watchdog tick: for services with exponential policy, detect crash loops
     * and apply backoff by stopping and pausing once the cap is reached.
     * systemd itself handles the simple fixed RestartSec case.
     */
    async tick() {
        const cfg = this.cfg();
        for (const svc of cfg.services) {
            if (svc.restartPolicy !== "exponential")
                continue;
            const b = this.getBackoff(svc.id);
            const name = unitName(svc.id);
            if (!systemUnitExists(name))
                continue;
            const props = await systemctlShow(name, ["ActiveState", "NRestarts"]);
            const nrestarts = Number(props.NRestarts || "0");
            if (props.ActiveState === "active") {
                // Healthy run resets the consecutive-failure counter after a short settle.
                if (Date.now() - b.lastStartAt > (svc.restartDelaySec || 3) * 1000 * 3) {
                    b.consecutiveFailures = 0;
                }
                continue;
            }
            if (props.ActiveState === "failed" || props.ActiveState === "inactive") {
                if (b.paused)
                    continue;
                b.consecutiveFailures = Math.max(b.consecutiveFailures, nrestarts);
                if (b.consecutiveFailures >= svc.maxRestarts) {
                    b.paused = true;
                    await systemctl("stop", name);
                    this.emit("paused", svc.id);
                }
            }
        }
    }
    startWatchdog(intervalMs = 5000) {
        const t = setInterval(() => {
            this.tick().catch(() => { });
        }, intervalMs);
        t.unref();
        this.timers.set("__watchdog__", t);
        return t;
    }
    shutdown() {
        for (const t of this.timers.values())
            clearInterval(t);
        this.timers.clear();
    }
}
export const serviceManager = new ServiceManager();
