declare const PKG = "@deepseek-ai/dsh";
export interface InstalledVersion {
    version: string;
    dir: string;
    dshPath: string;
    installedAt: string;
    active: boolean;
}
/** The dsh executable to use for a given version key. */
export declare function resolveDshExec(versionKey: string, systemDshPath: string): string;
export declare function listVersions(): {
    activeVersion: string;
    installed: InstalledVersion[];
};
/** Install a specific dsh version into an isolated directory. */
export declare function installVersion(version: string): Promise<{
    ok: boolean;
    log: string;
}>;
/** Switch which dsh version managed services boot with. */
export declare function activateVersion(versionKey: string): void;
export declare function fetchAvailableVersions(): Promise<string[]>;
export { PKG };
