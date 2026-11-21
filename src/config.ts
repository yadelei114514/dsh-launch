import fs from "node:fs";
import { configPath, ensureDir, dataHome, passwordPath, versionsDir } from "./paths.js";
import { hashPassword, type PasswordRecord, verifyPassword } from "./password.js";

export type RestartPolicy = "exponential" | "fixed" | "none";

export interface ServiceConfig {
  id: string;
  name: string;
  /** dsh subcommand, e.g. "web" or "headless". Only dsh is invoked. */
  profile: string;
  /** Extra arguments appended after the profile, e.g. ["--port","3080"]. */
  args: string[];
  /** Environment variables as KEY=value pairs. */
  env: Record<string, string>;
  workdir: string;
  port: number | null;
  autostart: boolean;
  restartPolicy: RestartPolicy;
  /** Max consecutive restart attempts before pausing (exponential policy). */
  maxRestarts: number;
  /** Base delay in seconds between restarts. */
  restartDelaySec: number;
  /** Memory cap in MiB applied via systemd MemoryMax; 0 = unlimited. */
  memoryMaxMiB: number;
  /** Which managed dsh version to boot ("system" = server's own dsh). */
  dshVersion: string;
  createdAt: string;
}

export interface LaunchConfig {
  version: 1;
  /** Reverse-proxy launch host, used in the UI. */
  launchHost: string;
  /** Public dsh web host used to build copyable token links. */
  dshHost: string;
  /** Default admin username. */
  adminUser: string;
  /** Port the manager binds to (loopback only by default). */
  bindHost: string;
  bindPort: number;
  /** dsh executable to use for the "system" version. */
  systemDshPath: string;
  services: ServiceConfig[];
}

const DEFAULT_CONFIG: LaunchConfig = {
  version: 1,
  launchHost: "launch.example.com",
  dshHost: "dsh.example.com",
  adminUser: "admin",
  bindHost: "127.0.0.1",
  bindPort: 8081,
  systemDshPath: "dsh",
  services: [],
};

export function loadConfig(): LaunchConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as LaunchConfig) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg: LaunchConfig): void {
  ensureDir(dataHome());
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export function getService(cfg: LaunchConfig, id: string): ServiceConfig | undefined {
  return cfg.services.find((s) => s.id === id);
}

export function newServiceId(): string {
  return "svc" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---- admin credential store ----

export interface AdminRecord {
  user: string;
  password: PasswordRecord;
  updatedAt: string;
}

export function hasAdmin(): boolean {
  return fs.existsSync(passwordPath());
}

export function loadAdmin(): AdminRecord | null {
  try {
    return JSON.parse(fs.readFileSync(passwordPath(), "utf8")) as AdminRecord;
  } catch {
    return null;
  }
}

export function setAdmin(user: string, password: string): void {
  const rec: AdminRecord = {
    user,
    password: hashPassword(password),
    updatedAt: new Date().toISOString(),
  };
  ensureDir(dataHome());
  fs.writeFileSync(passwordPath(), JSON.stringify(rec, null, 2), { mode: 0o600 });
}

export function checkAdmin(user: string, password: string): boolean {
  const rec = loadAdmin();
  if (!rec) return false;
  if (user !== rec.user) return false;
  return verifyPassword(password, rec.password);
}

export { versionsDir };
