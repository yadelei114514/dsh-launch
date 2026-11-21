import type { ServiceConfig } from "./config.js";
/**
 * Resolve an executable to an absolute path. systemd units do not inherit the
 * interactive shell's PATH, so a bare "dsh" (often an nvm shim) would fail.
 */
export declare function resolveExecutable(name: string): string | null;
/** Build a PATH for the unit that includes the resolved dsh + node dirs. */
export declare function buildPathEnv(dshExecAbs: string): string;
export interface ExecResult {
    code: number;
    stdout: string;
    stderr: string;
}
export declare function unitDir(): string;
export declare function unitName(svcId: string): string;
/** Build a systemd unit body for one managed dsh service. */
export declare function buildUnit(svc: ServiceConfig, dshExec: string): string;
export interface UnitPaths {
    systemPath: string | null;
    userPath: string;
}
/**
 * Write the unit to our managed directory, and try to link it into the
 * systemd search path. Applies enable/disable according to svc.autostart.
 * Returns where it landed.
 */
export declare function writeUnit(svc: ServiceConfig, dshExec: string): Promise<{
    name: string;
    content: string;
    installed: boolean;
}>;
/** Stop, disable and remove a managed unit file from the systemd search path. */
export declare function removeUnit(svcId: string): Promise<{
    removed: boolean;
}>;
/** Whether the unit file exists in the systemd system dir. */
export declare function systemUnitExists(name: string): boolean;
export declare function systemctl(...args: string[]): Promise<ExecResult>;
export declare function systemctlShow(name: string, props: string[]): Promise<Record<string, string>>;
/** Recent journal lines for a unit, newest last. */
export declare function journalLines(name: string, since?: string, lines?: number): Promise<string[]>;
/** Check sudo availability for systemctl (so UI can warn early). */
export declare function checkSystemctlAccess(): Promise<boolean>;
