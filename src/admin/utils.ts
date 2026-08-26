import { CardCommandError, ExitCode, getErrorMessage } from '../util/errors'

/**
 * HTTP status for an error that reached the top of a handler. A
 * {@link CardCommandError} classifies itself — a client-correctable refusal
 * (e.g. an import conflict that needs `overwrite`) is a 400 or 404, not the 500
 * every unexpected throw gets — so the admin UI and the MCP tools that share
 * these handlers can tell "you asked wrong" from "the server broke".
 */
function statusForError(error: unknown): number {
  if (!(error instanceof CardCommandError)) return 500
  if (error.exitCode === ExitCode.NotFound) return 404
  if (error.exitCode === ExitCode.UsageError) return 400
  return 500
}

export async function apiHandler(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler()
  } catch (error) {
    return Response.json(
      { success: false, message: getErrorMessage(error) },
      { status: statusForError(error) },
    )
  }
}
