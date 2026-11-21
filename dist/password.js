import crypto from "node:crypto";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;
export function hashPassword(password) {
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
export function verifyPassword(password, rec) {
    const salt = Buffer.from(rec.salt, "base64");
    const expected = Buffer.from(rec.hash, "base64");
    const actual = crypto.scryptSync(password, salt, expected.length, {
        N: rec.n,
        r: rec.r,
        p: rec.p,
    });
    if (actual.length !== expected.length)
        return false;
    return crypto.timingSafeEqual(actual, expected);
}
export function randomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString("base64url");
}
