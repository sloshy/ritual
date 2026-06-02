/**
 * Divert `console.log` to stderr. The MCP stdio transport uses stdout as its
 * JSON-RPC channel, so any stray `console.log` (from config init, card-ID
 * backfill, or a library) would corrupt the protocol stream. The SDK transport
 * writes to `process.stdout` directly and is unaffected by this.
 *
 * Kept SDK-free so the CLI entry point can call it in its preAction hook without
 * eagerly pulling the MCP SDK into every command's module graph.
 */
export function divertConsoleLogToStderr(): void {
  console.log = (...args: unknown[]): void => {
    console.error(...args)
  }
}
