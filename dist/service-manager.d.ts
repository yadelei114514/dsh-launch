import { EventEmitter } from "node:events";
import { type ServiceConfig } from "./config.js";
export type RuntimeState = "running" | "stopped" | "failed" | "activating" | "deactivating" | "unknown" | "paused";
export interface ServiceStatus {
    id: string;
    name: string;
    profile: string;
    state: RuntimeState;
    systemdState: string;
    subState: string;
    pid: number | null;
    memoryBytes: number | null;
    startedAt: string | null;
    token: string | null;
    /** Full copyable dsh web link (public host + token). */
    webLink: string | null;
    restartCount: number;
    paused: boolean;
    unitInstalled: boolean;
    dshVersion: string;
    lastError: string | null;
}
interface BackoffState {
    consecutiveFailures: number;
    paused: boolean;
    lastStartAt: number;
}
export declare class ServiceManager extends EventEmitter {
    private tokens;
    private backoff;
    private timers;
    private watched;
    getBackoff(id: string): BackoffState;
    /** Reset pause/failure counters when the user acts manually. */
    resetBackoff(id: string): void;
    private cfg;
    /**
     * Resolve the dsh executable for a service. A per-service dshVersion takes
     * precedence; "inherit" (or empty) falls back to the globally active version.
     */
    private resolveServiceExec;
    installAllUnits(): Promise<{
        id: string;
        installed: boolean;
        name: string;
    }[]>;
    installUnit(svc: ServiceConfig): Promise<{
        installed: boolean;
        name: string;
    }>;
    /** Remove a service's unit entirely (stop + disable + delete). */
    removeUnitForService(svcId: string): Promise<void>;
    /** Extract token from journal lines belonging to the current run. */
    private extractToken;
    private buildWebLink;
    getStatus(svc: ServiceConfig): Promise<ServiceStatus>;
    start(svc: ServiceConfig, manual?: boolean): Promise<void>;
    stop(svc: ServiceConfig, manual?: boolean): Promise<void>;
    restart(svc: ServiceConfig): Promise<void>;
    getLogs(svc: ServiceConfig, since?: string, lines?: number): Promise<string[]>;
    /**
     * Watchdog tick: for services with exponential policy, detect crash loops
     * and apply backoff by stopping and pausing once the cap is reached.
     * systemd itself handles the simple fixed RestartSec case.
     */
    tick(): Promise<void>;
    startWatchdog(intervalMs?: number): NodeJS.Timeout;
    shutdown(): void;
}
export declare const serviceManager: ServiceManager;
export {};
