import { versionsDir } from "./paths.js";
import { type PasswordRecord } from "./password.js";
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
export declare function loadConfig(): LaunchConfig;
export declare function saveConfig(cfg: LaunchConfig): void;
export declare function getService(cfg: LaunchConfig, id: string): ServiceConfig | undefined;
export declare function newServiceId(): string;
export interface AdminRecord {
    user: string;
    password: PasswordRecord;
    updatedAt: string;
}
export declare function hasAdmin(): boolean;
export declare function loadAdmin(): AdminRecord | null;
export declare function setAdmin(user: string, password: string): void;
export declare function checkAdmin(user: string, password: string): boolean;
export { versionsDir };
