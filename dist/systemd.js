import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { dataHome } from "./paths.js";
/**
 * Resolve an executable to an absolute path. systemd units do not inherit the
 * interactive shell's PATH, so a bare "dsh" (often an nvm shim) would fail.
 */
export function resolveExecutable(name) {
    if (path.isAbsolute(name))
        return fs.existsSync(name) ? name : null;
    try {
        const out = execFileSync("sh", ["-c", `command -v ${JSON.stringify(name)}`], { encoding: "utf8" }).trim();
        if (out && path.isAbsolute(out))
            return out;
    }
    catch { }
    return null;
}
/** Build a PATH for the unit that includes the resolved dsh + node dirs. */
export function buildPathEnv(dshExecAbs) {
    const dirs = new Set();
    dirs.add(path.dirname(dshExecAbs));
    const node = resolveExecutable("node");
    if (node)
        dirs.add(path.dirname(node));
    for (const p of ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"])
        dirs.add(p);
    return Array.from(dirs).join(":");
}
const exec = promisify(execFile);
async function run(cmd, args, timeout = 15000) {
    try {
        const { stdout, stderr } = await exec(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 });
        return { code: 0, stdout, stderr };
    }
    catch (err) {
        return {
            code: typeof err.code === "number" ? err.code : 1,
            stdout: err.stdout ?? "",
            stderr: err.stderr ?? String(err.message ?? err),
        };
    }
}
export function unitDir() {
    const d = path.join(dataHome(), "units");
    fs.mkdirSync(d, { recursive: true });
    return d;
}
export function unitName(svcId) {
    return `dsh-launch-${svcId}.service`;
}
function quoteEnv(v) {
    // systemd Environment= takes a single %-escaped argument; escape spaces/specials
    return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
/** Build a systemd unit body for one managed dsh service. */
export function buildUnit(svc, dshExec) {
    // Always use absolute path so systemd (which lacks the login PATH) can exec it.
    const absDsh = path.isAbsolute(dshExec) ? dshExec : resolveExecutable(dshExec) ?? dshExec;
    const pathEnv = buildPathEnv(absDsh);
    const userEnvLines = Object.entries(svc.env)
        .map(([k, v]) => `Environment="${k}=${quoteEnv(v)}"`)
        .join("\n");
    const envLines = `Environment="PATH=${quoteEnv(pathEnv)}"` + (userEnvLines ? "\n" + userEnvLines : "");
    const exec = [absDsh, "--profile", svc.profile, ...svc.args]
        .map((a) => (a.includes(" ") ? `"${a}"` : a))
        .join(" ");
    const memLine = svc.memoryMaxMiB > 0 ? `MemoryMax=${svc.memoryMaxMiB}M` : "# MemoryMax unlimited";
    // Restart policy: systemd handles crash restart for fixed; exponential pause
    // is coordinated by the manager process (see service-manager). For "none",
    // no auto restart.
    const restart = svc.restartPolicy === "none"
        ? "Restart=no"
        : `Restart=on-failure\nRestartSec=${svc.restartDelaySec || 3}`;
    return `[Unit]
Description=DSH Launch managed service: ${svc.name}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${svc.workdir || "/"}
${envLines ? envLines + "\n" : ""}ExecStart=${exec}
${restart}
${memLine}
# Capture stdout/stderr into the journal for the manager to read token + logs.
StandardOutput=journal
StandardError=journal
KillMode=mixed
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
`;
}
/**
 * Write the unit to our managed directory, and try to link it into the
 * systemd search path. Applies enable/disable according to svc.autostart.
 * Returns where it landed.
 */
export async function writeUnit(svc, dshExec) {
    const name = unitName(svc.id);
    const content = buildUnit(svc, dshExec);
    const localPath = path.join(unitDir(), name);
    fs.writeFileSync(localPath, content, { mode: 0o644 });
    // Attempt system-wide install; needs privilege (sudo). Best-effort.
    const sysDir = "/etc/systemd/system";
    let installed = false;
    const cp = await run("sudo", ["-n", "cp", localPath, path.join(sysDir, name)]);
    if (cp.code === 0) {
        await run("sudo", ["-n", "systemctl", "daemon-reload"]);
        if (svc.autostart) {
            await run("sudo", ["-n", "systemctl", "enable", name]);
        }
        else {
            await run("sudo", ["-n", "systemctl", "disable", name]);
        }
        installed = true;
    }
    return { name, content, installed };
}
/** Stop, disable and remove a managed unit file from the systemd search path. */
export async function removeUnit(svcId) {
    const name = unitName(svcId);
    await run("sudo", ["-n", "systemctl", "stop", name]);
    await run("sudo", ["-n", "systemctl", "disable", name]);
    const rm = await run("sudo", ["-n", "rm", "-f", path.join("/etc/systemd/system", name)]);
    await run("sudo", ["-n", "systemctl", "daemon-reload"]);
    // Best-effort local copy cleanup.
    try {
        fs.rmSync(path.join(unitDir(), name), { force: true });
    }
    catch { }
    return { removed: rm.code === 0 };
}
/** Whether the unit file exists in the systemd system dir. */
export function systemUnitExists(name) {
    return fs.existsSync(path.join("/etc/systemd/system", name));
}
// ---- control helpers ----
export async function systemctl(...args) {
    // Prefer non-interactive sudo when not root.
    const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
    if (isRoot)
        return run("systemctl", args);
    return run("sudo", ["-n", "systemctl", ...args]);
}
export async function systemctlShow(name, props) {
    const r = await systemctl("show", name, ...props.map((p) => `--property=${p}`));
    const out = {};
    if (r.code !== 0)
        return out;
    for (const line of r.stdout.split("\n")) {
        const idx = line.indexOf("=");
        if (idx < 0)
            continue;
        out[line.slice(0, idx)] = line.slice(idx + 1);
    }
    return out;
}
/** Recent journal lines for a unit, newest last. */
export async function journalLines(name, since = "1 hour ago", lines = 400) {
    const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
    const args = ["-u", name, "--since", since, "-n", String(lines), "--no-pager", "-o", "cat"];
    const r = isRoot ? await run("journalctl", args) : await run("sudo", ["-n", "journalctl", ...args]);
    if (r.code !== 0)
        return [];
    return r.stdout.split("\n").filter(Boolean);
}
/** Check sudo availability for systemctl (so UI can warn early). */
export async function checkSystemctlAccess() {
    const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
    if (isRoot)
        return true;
    const r = await run("sudo", ["-n", "systemctl", "is-system-running"]);
    // is-system-running exits non-zero in degraded state but still ran.
    return r.code === 0 || r.stderr === "" || !/password|not allowed|a password is required/i.test(r.stderr);
}
