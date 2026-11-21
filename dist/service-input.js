import { newServiceId } from "./config.js";
/**
 * Validate and normalize a service create/update payload. Only dsh profiles are
 * accepted as the subcommand; args and env keys are checked to prevent breaking
 * out of the generated systemd unit.
 */
export function sanitizeServiceInput(body, existing) {
    const profile = String(body.profile ?? existing?.profile ?? "web").trim();
    if (!/^[a-z][a-z0-9_-]*$/i.test(profile)) {
        throw new Error("invalid dsh profile name");
    }
    const rawArgs = Array.isArray(body.args) ? body.args : existing?.args ?? [];
    const args = rawArgs.map((a) => String(a));
    for (const a of args) {
        if (/[\n\r]/.test(a))
            throw new Error("invalid character in args");
    }
    const env = {};
    const rawEnv = body.env && typeof body.env === "object" ? body.env : existing?.env ?? {};
    for (const [k, v] of Object.entries(rawEnv)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
            throw new Error(`invalid env key: ${k}`);
        if (/[\n\r]/.test(String(v)))
            throw new Error(`invalid env value for ${k}`);
        env[k] = String(v);
    }
    const restartPolicy = ["exponential", "fixed", "none"].includes(body.restartPolicy)
        ? body.restartPolicy
        : existing?.restartPolicy ?? "exponential";
    return {
        id: existing?.id ?? newServiceId(),
        name: String(body.name ?? existing?.name ?? "dsh web").trim() || "dsh web",
        profile,
        args,
        env,
        workdir: String(body.workdir ?? existing?.workdir ?? "/").trim() || "/",
        port: body.port != null && body.port !== "" ? Number(body.port) : existing?.port ?? null,
        autostart: Boolean(body.autostart ?? existing?.autostart ?? false),
        restartPolicy,
        maxRestarts: Math.max(1, Number(body.maxRestarts ?? existing?.maxRestarts ?? 5)),
        restartDelaySec: Math.max(1, Number(body.restartDelaySec ?? existing?.restartDelaySec ?? 3)),
        memoryMaxMiB: Math.max(0, Number(body.memoryMaxMiB ?? existing?.memoryMaxMiB ?? 0)),
        dshVersion: String(body.dshVersion ?? existing?.dshVersion ?? "inherit"),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
}
