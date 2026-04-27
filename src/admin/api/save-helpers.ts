import { loadHash, computeHash } from '../../content-hash'
import { loadRitualConfig } from '../../ritual-config'
import { shouldAutoCommit, shouldAutoPush, commitFiles, pushChanges } from '../git'
import { MAX_BODY_SIZE } from '../validation'

export type HashValidationSuccess = {
  valid: true
  content: string
}

export type HashValidationConflict = {
  valid: false
  response: Response
}

export type HashValidationResult = HashValidationSuccess | HashValidationConflict

/** Return a 413 Response if the request body exceeds MAX_BODY_SIZE, or null if OK. */
export function validateBodySize(req: Request): Response | null {
  const contentLength = Number(req.headers.get('Content-Length') ?? '0')
  if (contentLength > MAX_BODY_SIZE) {
    return Response.json({ success: false, message: 'Request body too large' }, { status: 413 })
  }
  return null
}

/**
 * Read the file, compare its hash against the client-provided hash, and return
 * a 409 conflict response if they differ. On success, returns the file content
 * so callers can reuse it without a second read.
 */
export async function validateContentHash(
  filePath: string,
  clientHash: string,
  entityLabel: string,
): Promise<HashValidationResult> {
  const content = await Bun.file(filePath).text()
  const existingHash = (await loadHash(filePath)) ?? computeHash(content)
  if (existingHash !== clientHash) {
    return {
      valid: false,
      response: Response.json(
        {
          success: false,
          message: `${entityLabel} has been modified since you loaded it. Please reload.`,
          conflict: true,
        },
        { status: 409 },
      ),
    }
  }
  return { valid: true, content }
}

/** Commit files and push if the config enables auto-commit/auto-push for the given directory. */
export async function autoCommitAndPush(
  dir: string,
  files: string[],
  message: string,
): Promise<void> {
  const config = await loadRitualConfig()
  if (shouldAutoCommit(config, dir)) {
    commitFiles(files, message)
    if (shouldAutoPush(config, dir)) {
      pushChanges(dir)
    }
  }
}
