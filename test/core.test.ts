import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, randomToken } from "../dist/password.js";
import { buildUnit, resolveExecutable, buildPathEnv } from "../dist/systemd.js";
import { sanitizeServiceInput as sanitizeServiceInputForTest } from "../dist/service-input.js";
import type { ServiceConfig } from "../dist/config.js";

// ---- password ----
test("password: hash then verify succeeds", () => {
  const rec = hashPassword("correct horse battery");
  assert.equal(rec.algo, "scrypt");
  assert.ok(rec.salt && rec.hash);
  assert.equal(verifyPassword("correct horse battery", rec), true);
});

test("password: wrong password fails", () => {
  const rec = hashPassword("secret123");
  assert.equal(verifyPassword("secret124", rec), false);
});

test("password: not stored as plaintext", () => {
  const rec = hashPassword("plaintext-visible?");
  assert.ok(!JSON.stringify(rec).includes("plaintext-visible?"));
});

test("randomToken: url-safe and unique", () => {
  const a = randomToken();
  const b = randomToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

// ---- unit generation ----
function svc(over: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    id: "svc1",
    name: "dsh web",
    profile: "web",
    args: ["--no-open", "--port", "3080"],
    env: {},
    workdir: "/opt",
    port: 3080,
    autostart: true,
    restartPolicy: "exponential",
    maxRestarts: 5,
    restartDelaySec: 3,
    memoryMaxMiB: 2048,
    dshVersion: "inherit",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

test("unit: absolute ExecStart with profile and args", () => {
  const u = buildUnit(svc(), "/usr/local/bin/dsh");
  assert.match(u, /ExecStart=\/usr\/local\/bin\/dsh --profile web --no-open --port 3080/);
  assert.match(u, /WorkingDirectory=\/opt/);
  assert.match(u, /MemoryMax=2048M/);
  assert.match(u, /Restart=on-failure/);
  assert.match(u, /Environment="PATH=/);
});

test("unit: no restart for policy none", () => {
  const u = buildUnit(svc({ restartPolicy: "none", memoryMaxMiB: 0 }), "/usr/bin/dsh");
  assert.match(u, /Restart=no/);
  assert.match(u, /# MemoryMax unlimited/);
});

test("unit: env vars are quoted", () => {
  const u = buildUnit(svc({ env: { FOO: "bar baz" } }), "/usr/bin/dsh");
  assert.match(u, /Environment="FOO=bar baz"/);
});

test("unit: quotes args containing spaces", () => {
  const u = buildUnit(svc({ args: ["--title", "my harness"] }), "/usr/bin/dsh");
  assert.match(u, /--title "my harness"/);
});

// ---- service input validation ----
test("sanitize: rejects invalid profile", () => {
  assert.throws(() => sanitizeServiceInputForTest({ profile: "../../etc/passwd" }));
});

test("sanitize: rejects newline in args", () => {
  assert.throws(() => sanitizeServiceInputForTest({ args: ["a\nb"] }));
});

test("sanitize: rejects bad env key", () => {
  assert.throws(() => sanitizeServiceInputForTest({ env: { "BAD KEY": "x" } }));
});

test("sanitize: accepts valid input and coerces", () => {
  const s = sanitizeServiceInputForTest({
    name: "web",
    profile: "web",
    args: ["--port", "8080"],
    env: { HOME: "/root" },
    memoryMaxMiB: "1024",
    maxRestarts: "3",
  });
  assert.equal(s.profile, "web");
  assert.equal(s.memoryMaxMiB, 1024);
  assert.equal(s.maxRestarts, 3);
  assert.deepEqual(s.args, ["--port", "8080"]);
});
