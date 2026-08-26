import * as fs from 'node:fs/promises'
import path from 'node:path'
import { writeFileWithHash } from '../changes/content-hash'
import { t } from '../i18n/t'
import type { DeckFormatKey } from './deck-format'
import { newDeckMarkdown } from './deck-file'
import { listFileName, unusableFileNameMessage } from './list-file-name'
import { listNameCollision } from './list-lifecycle'
import type { ListType } from './list-type'
import { dirForType } from './resolve-list'
import { CardCommandError, ExitCode } from '../util/errors'

/**
 * Ensure `fileName` exists in `dir`, creating it (and the directory) with
 * `initialContent` and a content hash when missing. Returns the resolved path.
 */
export async function ensureListFile(
  dir: string,
  fileName: string,
  initialContent: string,
  label: string,
): Promise<string> {
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, fileName)
  if (!(await Bun.file(filePath).exists())) {
    await writeFileWithHash(filePath, initialContent)
    console.log(t('cli.session.createdFile', { label, file: fileName }))
  } else {
    console.log(t('cli.session.usingFile', { label, file: fileName }))
  }
  return filePath
}

/**
 * Ensure the list named `name` of `type` exists, creating it with
 * `initialContent` when missing. Throws when the name has no usable filename
 * characters; callers that take a name from the user validate it first.
 *
 * A name that folds onto a *different* existing list (e.g. `atraxa binder`
 * against `Atraxa Binder.md`) is refused with the same usage error `ritual new`
 * gives, rather than creating a second, unreachable twin. The byte-identical
 * path is not a collision: that is the "use the existing file" case.
 */
async function ensureNamedListFile(
  type: ListType,
  name: string,
  initialContent: string,
): Promise<string> {
  const fileName = listFileName(name)
  if (fileName === null) {
    throw new Error(unusableFileNameMessage(name))
  }
  const dir = dirForType(type)
  if (!(await Bun.file(path.join(dir, fileName)).exists())) {
    const collision = await listNameCollision(type, name)
    // Mirrors `lifecycleErrorToCommandError` in src/cli/action.ts, which this
    // domain module must not import: a collision is a usage error (exit 2).
    if (collision) throw new CardCommandError('usage_error', collision.message, ExitCode.UsageError)
  }
  return ensureListFile(dir, fileName, initialContent, t('cli.edit.listNoun', { type }))
}

/**
 * Ensure a deck file exists for `name`, creating it with YAML front matter when
 * missing (mirroring `ritual new deck`). Returns the resolved file path.
 * `format` only applies to a newly created file — an existing deck keeps its own.
 */
export async function ensureDeckFile(name: string, format: DeckFormatKey): Promise<string> {
  return ensureNamedListFile('deck', name, newDeckMarkdown(name, format))
}

/**
 * Ensure a collection file exists for `collectionName`, creating it with a
 * markdown heading when missing. Returns the resolved file path.
 */
export async function ensureCollectionFile(collectionName: string): Promise<string> {
  return ensureNamedListFile('collection', collectionName, `# ${collectionName}\n\n`)
}

/** Ensure a wanted-list file exists for `name`, creating it with a markdown heading when missing. */
export async function ensureWantedListFile(name: string): Promise<string> {
  return ensureNamedListFile('wanted', name, `# ${name}\n\n`)
}
