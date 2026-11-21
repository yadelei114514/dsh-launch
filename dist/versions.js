import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { versionsDir, ensureDir } from "./paths.js";
const exec = promisify(execFile);
const PKG = "@deepseek-ai/dsh";
function metaPath() {
    return path.join(versionsDir(), "installed.json");
}
function loadMeta() {
    try {
        return JSON.parse(fs.readFileSync(metaPath(), "utf8"));
    }
    catch {
        return { activeVersion: "system", installed: [] };
    }
}
function saveMeta(m) {
    fs.writeFileSync(metaPath(), JSON.stringify(m, null, 2), { mode: 0o600 });
}
/** The dsh executable to use for a given version key. */
export function resolveDshExec(versionKey, systemDshPath) {
    if (versionKey === "system")
        return systemDshPath;
    const dir = path.join(versionsDir(), versionKey);
    return path.join(dir, "node_modules", ".bin", "dsh");
}
export function listVersions() {
    const meta = loadMeta();
    const installed = meta.installed.map((v) => ({
        version: v.version,
        dir: path.join(versionsDir(), v.version),
        dshPath: resolveDshExec(v.version, "dsh"),
        installedAt: v.installedAt,
        active: meta.activeVersion === v.version,
    }));
    return { activeVersion: meta.activeVersion, installed };
}
async function runNpm(args, cwd, timeout = 180000) {
    try {
        const { stdout, stderr } = await exec("npm", args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 });
        return { code: 0, stdout, stderr };
    }
    catch (err) {
        return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
    }
}
/** Install a specific dsh version into an isolated directory. */
export async function installVersion(version) {
    if (!/^[0-9A-Za-z.\-]+$/.test(version)) {
        return { ok: false, log: "invalid version string" };
    }
    const dir = path.join(versionsDir(), version);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: `dsh-${version}`, private: true }, null, 2));
    const r = await runNpm(["install", `${PKG}@${version}`, "--no-audit", "--no-fund", "--loglevel=error"], dir);
    if (r.code !== 0)
        return { ok: false, log: r.stdout + r.stderr };
    const bin = path.join(dir, "node_modules", ".bin", "dsh");
    if (!fs.existsSync(bin)) {
        return { ok: false, log: `installed but missing bin at ${bin}\n` + r.stdout + r.stderr };
    }
    const meta = loadMeta();
    if (!meta.installed.some((v) => v.version === version)) {
        meta.installed.push({ version, installedAt: new Date().toISOString() });
        saveMeta(meta);
    }
    return { ok: true, log: (r.stdout + r.stderr).trim() || "installed" };
}
/** Switch which dsh version managed services boot with. */
export function activateVersion(versionKey) {
    const meta = loadMeta();
    if (versionKey !== "system" && !meta.installed.some((v) => v.version === versionKey)) {
        throw new Error(`version ${versionKey} is not installed`);
    }
    meta.activeVersion = versionKey;
    saveMeta(meta);
}
export async function fetchAvailableVersions() {
    const dir = versionsDir();
    const r = await runNpm(["view", PKG, "versions", "--json"], dir, 60000);
    if (r.code !== 0)
        return [];
    try {
        const arr = JSON.parse(r.stdout);
        return Array.isArray(arr) ? arr : [arr];
    }
    catch {
        return [];
    }
}
export { PKG };
