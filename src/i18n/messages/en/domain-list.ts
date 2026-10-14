/**
 * `domain.list.*` (grammar) — the refusals of the list-metadata grammars both
 * SPAs bundle: a card's custom-art reference (`src/list/card-art.ts`), a list's
 * cover image (`src/list/list-image.ts`), a list's description
 * (`src/list/list-description.ts`) and a list's categories record
 * (`src/list/card-categories-record.ts`).
 *
 * A fragment of the domain namespace, registered by the CLI and **both** SPAs,
 * so a refusal these modules word resolves wherever they run. The admin's art
 * and cover modals and its Add Card dialog parse a reference as it is typed and
 * show the refusal under the field. The same sentence reaches the admin API and
 * MCP as English plus its key, and the CLI renders it in its own language. The
 * list-file engines' other text — sidecar and front-matter problems, lifecycle
 * refusals, the rewrite gates — lives in `domain-list-files`, which only the
 * CLI and the admin register.
 *
 * The keys `file`, `url` and `card` are front-matter and JSON vocabulary, quoted
 * as the user wrote them; file paths, URLs and image extensions are user data
 * or machine vocabulary. All stay as they are inside the sentences that name
 * them.
 */

import type { MessageCatalogShape } from '../../types'

export const domainListMessages = {
  // ── A card's custom-art reference ─────────────────────────────────────
  'domain.list.art.fileNotString': '"file" must be a string',
  'domain.list.art.fileEmpty': '"file" must not be empty',
  'domain.list.art.backslashes': '"{file}" must use forward slashes',
  'domain.list.art.absolute': '"{file}" must be relative to the art directory, not absolute',
  'domain.list.art.escapes': '"{file}" escapes the art directory',
  'domain.list.art.directory': '"{file}" is a directory, not an image file',
  'domain.list.art.notImage':
    '"{file}" is not an image file — custom art must be one of: {extensions}',
  'domain.list.art.urlNotString': '"url" must be a string',
  'domain.list.art.invalidUrl': '"{url}" is not a valid URL',
  'domain.list.art.notHttp': '"{url}" must be an http(s) URL',
  'domain.list.art.notObject': 'an art reference must be an object with a "file" or "url"',
  'domain.list.art.unknownKeys': 'an art reference has no such key: {keys}',
  'domain.list.art.fileAndUrl': 'an art reference must have either "file" or "url", not both',
  'domain.list.art.noFileOrUrl': 'an art reference must have a "file" or a "url"',
  'domain.list.art.empty': 'an art reference must not be empty',

  // ── A list's cover image ──────────────────────────────────────────────
  'domain.list.image.cardNotId': '"card" must be a positive card id',
  'domain.list.image.unknownKeys': 'a list image has no such key: {keys}',
  'domain.list.image.shape': 'a list image must be a mapping with one of "card", "file" or "url"',
  'domain.list.image.exactlyOne': 'a list image must have exactly one of "card", "file" or "url"',

  // ── A list's description ──────────────────────────────────────────────
  'domain.list.description.notText': 'a list description must be text',

  // ── A list's categories file ───────────────────────────────────────────
  'domain.list.sidecar.invalidJson': 'not valid JSON: {error}',
  'domain.list.categories.notObject':
    'the file must contain a JSON object with "order" and "cards"',
  'domain.list.categories.cardsNotObject': '"cards" must be an object keyed by card name',
  'domain.list.categories.emptyName': 'a "cards" key must be a card name, not empty',
  'domain.list.categories.noCategories': '"{name}" has no categories — remove the key instead',
  'domain.list.categories.duplicateName': '"{name}" appears twice under different spellings',
} as const satisfies MessageCatalogShape
