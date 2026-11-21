/** Resolve the install root (repo dir containing package.json + dist). */
export declare function installRoot(): string;
/**
 * Where runtime state lives: config, password hash, sessions, managed dsh
 * installs, generated systemd unit names. Overridable via DSH_LAUNCH_HOME so
 * the systemd service account can point it at a persistent directory.
 */
export declare function dataHome(): string;
export declare function ensureDir(dir: string): void;
export declare function configPath(): string;
export declare function passwordPath(): string;
export declare function versionsDir(): string;
export declare function hostname(): string;
