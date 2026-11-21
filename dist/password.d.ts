/**
 * Password hashing using scrypt with a random per-user salt. Stored record is
 * JSON: { algo, salt, hash, n, r, p }. Never stores plaintext.
 */
export interface PasswordRecord {
    algo: "scrypt";
    salt: string;
    hash: string;
    n: number;
    r: number;
    p: number;
}
export declare function hashPassword(password: string): PasswordRecord;
export declare function verifyPassword(password: string, rec: PasswordRecord): boolean;
export declare function randomToken(bytes?: number): string;
