export interface Session {
    token: string;
    user: string;
    createdAt: number;
    expiresAt: number;
}
export declare function createSession(user: string): Session;
export declare function getSession(token: string | undefined): Session | null;
export declare function destroySession(token: string | undefined): void;
export declare function parseCookies(header: string | undefined): Record<string, string>;
export declare const SESSION_COOKIE = "dshl_session";
