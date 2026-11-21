import crypto from "node:crypto";

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

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;

export function hashPassword(password: string): PasswordRecord {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return {
    algo: "scrypt",
    salt: salt.toString("base64"),
    hash: hash.toString("base64"),
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  };
}

export function verifyPassword(password: string, rec: PasswordRecord): boolean {
  const salt = Buffer.from(rec.salt, "base64");
  const expected = Buffer.from(rec.hash, "base64");
  const actual = crypto.scryptSync(password, salt, expected.length, {
    N: rec.n,
    r: rec.r,
    p: rec.p,
  });
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
