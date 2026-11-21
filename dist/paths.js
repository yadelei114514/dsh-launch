import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
/** Resolve the install root (repo dir containing package.json + dist). */
export function installRoot() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/ lives one level below the project root at build time.
    return path.resolve(here, "..");
}
/**
 * Where runtime state lives: config, password hash, sessions, managed dsh
 * installs, generated systemd unit names. Overridable via DSH_LAUNCH_HOME so
 * the systemd service account can point it at a persistent directory.
 */
export function dataHome() {
    const dir = process.env.DSH_LAUNCH_HOME
        ? path.resolve(process.env.DSH_LAUNCH_HOME)
        : path.join(installRoot(), "data");
    ensureDir(dir);
    return dir;
}
export function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}
export function configPath() {
    return path.join(dataHome(), "config.json");
}
export function passwordPath() {
    return path.join(dataHome(), "admin.json");
}
export function versionsDir() {
    const d = path.join(dataHome(), "versions");
    ensureDir(d);
    return d;
}
export function hostname() {
    return os.hostname();
}
