import { type ServiceConfig } from "./config.js";
/**
 * Validate and normalize a service create/update payload. Only dsh profiles are
 * accepted as the subcommand; args and env keys are checked to prevent breaking
 * out of the generated systemd unit.
 */
export declare function sanitizeServiceInput(body: any, existing?: ServiceConfig): ServiceConfig;
