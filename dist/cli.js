#!/usr/bin/env node
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig, setAdmin, hasAdmin } from "./config.js";
import { createApp, bootstrapState } from "./server.js";
import { serviceManager } from "./service-manager.js";
import { dataHome, installRoot } from "./paths.js";
import { unitName } from "./systemd.js";
function ask(rl, q, def = "") {
    return new Promise((resolve) => {
        rl.question(def ? `${q} [${def}]: ` : `${q}: `, (a) => resolve(a.trim() || def));
    });
}
function askHidden(q) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        const onData = (char) => {
            const s = char.toString();
            if (s === "\n" || s === "\r" || s === "\u0004") {
                process.stdin.removeListener("data", onData);
            }
            else if (s === "\u0003") {
                process.exit(1);
            }
        };
        // Best-effort hidden read; fall back to normal if TTY mangles it.
        rl._writeToOutput = (s) => {
            if (s.includes(q))
                rl.output.write(s);
            else
                rl.output.write("*");
        };
        rl.question(q, (a) => {
            rl.close();
            process.stdin.removeListener("data", onData);
            process.stdout.write("\n");
            resolve(a);
        });
    });
}
async function cmdServe() {
    const cfg = loadConfig();
    const app = createApp();
    await bootstrapState(app);
    const host = process.env.DSH_LAUNCH_BIND_HOST || cfg.bindHost;
    const port = Number(process.env.DSH_LAUNCH_BIND_PORT || cfg.bindPort);
    app.listen(port, host, () => {
        console.log(`dsh-launch listening on http://${host}:${port}`);
        if (!hasAdmin())
            console.log("WARNING: no admin account yet. Run: dsh-launch set-password");
    });
    const shutdown = () => {
        serviceManager.shutdown();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
async function cmdSetPassword() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const user = await ask(rl, "Admin username", loadConfig().adminUser);
    rl.close();
    const p1 = await askHidden("Admin password (min 8 chars): ");
    const p2 = await askHidden("Confirm password: ");
    if (p1.length < 8) {
        console.error("password must be at least 8 characters");
        process.exit(1);
    }
    if (p1 !== p2) {
        console.error("passwords do not match");
        process.exit(1);
    }
    setAdmin(user, p1);
    console.log(`Admin account '${user}' saved (hashed) at ${dataHome()}`);
}
async function cmdInstall() {
    console.log("=== DSH Launch interactive installer ===\n");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const launchHost = await ask(rl, "Public host for the manager UI (reverse-proxied)", "launch.example.com");
    const dshHost = await ask(rl, "Public host for dsh web (used in token links)", "dsh.example.com");
    const systemDshPath = await ask(rl, "Path to existing dsh executable", "dsh");
    const bindHost = await ask(rl, "Manager bind host (loopback recommended)", "127.0.0.1");
    const bindPort = Number(await ask(rl, "Manager bind port", "8081"));
    const cfg = loadConfig();
    cfg.launchHost = launchHost;
    cfg.dshHost = dshHost;
    cfg.systemDshPath = systemDshPath;
    cfg.bindHost = bindHost;
    cfg.bindPort = bindPort;
    console.log("\n-- Create the default 'dsh web' service --");
    const webPort = Number(await ask(rl, "dsh web listen port", "3080"));
    const webWorkdir = await ask(rl, "dsh web working directory", "/");
    const memMiB = Number(await ask(rl, "Memory cap in MiB (0 = unlimited)", "4096"));
    const autostart = (await ask(rl, "Start on boot? (y/n)", "y")).toLowerCase().startsWith("y");
    const existing = cfg.services.find((s) => s.profile === "web");
    const svc = existing ?? {
        id: "svc" + Date.now().toString(36),
        name: "dsh web",
        profile: "web",
        args: [],
        env: {},
        workdir: webWorkdir,
        port: webPort,
        autostart,
        restartPolicy: "exponential",
        maxRestarts: 5,
        restartDelaySec: 3,
        memoryMaxMiB: memMiB,
        dshVersion: "inherit",
        createdAt: new Date().toISOString(),
    };
    svc.args = ["--no-open", "--port", String(webPort)];
    svc.workdir = webWorkdir;
    svc.port = webPort;
    svc.autostart = autostart;
    svc.memoryMaxMiB = memMiB;
    if (!existing)
        cfg.services.push(svc);
    saveConfig(cfg);
    rl.close();
    console.log("\n-- Admin account --");
    await cmdSetPassword();
    console.log("\n-- Writing systemd unit for dsh web --");
    const inst = await serviceManager.installUnit(svc);
    console.log(inst.installed ? `  unit installed: ${unitName(svc.id)}` : "  unit NOT installed (needs sudo/root). See generated unit in data/units/.");
    console.log(`\nConfig written to ${path.join(dataHome(), "config.json")}`);
    console.log("Install the manager itself as a service with the provided dsh-launch.service.example,");
    console.log("then start it: systemctl enable --now dsh-launch");
}
async function main() {
    const cmd = process.argv[2] ?? "serve";
    switch (cmd) {
        case "serve":
            await cmdServe();
            break;
        case "install":
            await cmdInstall();
            break;
        case "set-password":
            await cmdSetPassword();
            break;
        case "version":
        case "--version":
            console.log((JSON.parse(fs.readFileSync(path.join(installRoot(), "package.json"), "utf8"))).version);
            break;
        default:
            console.log(`dsh-launch commands:
  serve          start the manager web server
  install        interactive setup (config + admin + default dsh web unit)
  set-password   set/reset the admin password
  version        print version`);
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
