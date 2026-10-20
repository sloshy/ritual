import { resolveStringOverride } from '../config/env-override'
import { ENV_VAR } from '../util/cli-tokens'

/**
 * Resolve the MCP bearer token. An explicit CLI value takes precedence; otherwise
 * the env value (defaulting to `RITUAL_MCP_TOKEN`) is used. Empty/whitespace-only
 * values from either source are treated as absent. Returns undefined when neither
 * is set. The env value is a parameter (mirroring `resolveCacheServerAddress`) so
 * it can be tested without mutating `process.env`.
 *
 * SDK-free so the CLI commands can import it without pulling the MCP SDK in.
 */
export function resolveMcpToken(
  cliToken?: string,
  envToken: string | undefined = process.env[ENV_VAR.mcpToken],
): string | undefined {
  return resolveStringOverride(cliToken, envToken)
}
