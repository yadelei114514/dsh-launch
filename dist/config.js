import fs from "node:fs";
import { configPath, ensureDir, dataHome, passwordPath, versionsDir } from "./paths.js";
import { hashPassword, verifyPassword } from "./password.js";
const DEFAULT_CONFIG = {
    version: 1,
    launchHost: "launch.example.com",
    dshHost: "dsh.example.com",
    adminUser: "admin",
    bindHost: "127.0.0.1",
    bindPort: 8081,
    systemDshPath: "dsh",
    services: [],
};
export function loadConfig() {
    try {
        const raw = fs.readFileSync(configPath(), "utf8");
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
    catch {
        return { ...DEFAULT_CONFIG };
    }
}
export function saveConfig(cfg) {
    ensureDir(dataHome());
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
export function getService(cfg, id) {
    return cfg.services.find((s) => s.id === id);
}
export function newServiceId() {
    return "svc" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
export function hasAdmin() {
    return fs.existsSync(passwordPath());
}
export function loadAdmin() {
    try {
        return JSON.parse(fs.readFileSync(passwordPath(), "utf8"));
    }
    catch {
        return null;
    }
}
export function setAdmin(user, password) {
    const rec = {
        user,
        password: hashPassword(password),
        updatedAt: new Date().toISOString(),
    };
    ensureDir(dataHome());
    fs.writeFileSync(passwordPath(), JSON.stringify(rec, null, 2), { mode: 0o600 });
}
export function checkAdmin(user, password) {
    const rec = loadAdmin();
    if (!rec)
        return false;
    if (user !== rec.user)
        return false;
    return verifyPassword(password, rec.password);
}
export { versionsDir };
