import * as fs from 'node:fs/promises'
import { handleListSave } from '../../src/admin/api/list-save'
import type { ChangeEvent, ChangeInput } from '../../src/changes/change-event'
import { computeHash } from '../../src/changes/content-hash'
import type { ListType } from '../../src/list/list-type'

/**
 * A change as a test hands it to the save route: either a full event (its
 * envelope is ignored by the route) or the wire form, or a deliberately
 * malformed object — the wire is unvalidated, which is what refusal tests probe.
 */
export type SaveChange = ChangeEvent | ChangeInput | Record<string, unknown>

/** Everything a save request carries besides the changes. */
export type ListSaveOptions = {
  /** Defaults to the hash of `filePath` as it stands. */
  contentHash?: string
  continueSession?: boolean
  validateCardNames?: boolean
}

/** The hash a load would hand the client: the file's own content, hashed. */
export async function hashOf(filePath: string): Promise<string> {
  return computeHash(await fs.readFile(filePath, 'utf-8'))
}

/** The save request a client would POST for `changes`. */
export function listSaveRequest(
  type: ListType,
  slug: string,
  changes: readonly SaveChange[],
  options: ListSaveOptions & { contentHash: string },
): Request {
  return new Request(`http://localhost/api/${type}/${encodeURIComponent(slug)}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes, ...options }),
  })
}

/**
 * POST `changes` to the `type` list `slug`'s save route, in-process. The
 * content hash defaults to the file's current one, which is what an editor
 * that just loaded the list would send.
 */
export async function saveList(
  type: ListType,
  slug: string,
  filePath: string,
  changes: readonly SaveChange[],
  options: ListSaveOptions = {},
): Promise<Response> {
  const contentHash = options.contentHash ?? (await hashOf(filePath))
  return handleListSave(listSaveRequest(type, slug, changes, { ...options, contentHash }), type)
}
