/** Environment variable that supplies the MCP bearer token when no CLI flag is given. */
export const MCP_TOKEN_ENV = 'RITUAL_MCP_TOKEN'

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
  envToken: string | undefined = process.env[MCP_TOKEN_ENV],
): string | undefined {
  const cli = cliToken?.trim()
  if (cli) return cli
  const env = envToken?.trim()
  return env ? env : undefined
}
