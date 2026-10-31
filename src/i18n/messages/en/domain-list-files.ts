/**
 * `domain.list.*` (files) — the text of the engines that read and write list
 * files (`src/list/`): sidecar and front-matter problems, the cover-image and
 * metadata writers' refusals, list create/rename/delete refusals, the
 * whole-file-rewrite gate, the `&N` backfill's operator log, and the guards
 * that catch an engine called the wrong way.
 *
 * A fragment of the domain namespace, registered by the CLI and the admin SPA.
 * These run under the CLI, the admin API and the MCP server alike, so a
 * refusal is built once as English plus its key: the API and MCP read the
 * English, the CLI renders the key in its own language, and the admin renders
 * it in the reader's. The public site never writes a list file. The grammar
 * refusals both SPAs validate in the browser (art references, cover images,
 * descriptions) live in `domain-list`.
 *
 * File paths, list and card names, YAML and JSON key names (`labels`,
 * `order`, `cards`), the `&N` card-id syntax, deck-format slugs and the
 * function names in the guard messages are user data or machine vocabulary,
 * and stay as they are inside the sentences that mention them.
 */

import type { MessageCatalogShape } from '../../types'

export const domainListFilesMessages = {
  // ── Sidecar files ─────────────────────────────────────────────────────
  'domain.list.sidecar.problem': '{file}: {reason}',
  'domain.list.sidecar.notListPath': 'Not a list markdown path: {path}',
  'domain.list.art.sidecarNotObject': 'the file must contain a JSON object keyed by card id',
  'domain.list.art.sidecarBadKey': '"{key}" is not a card id — keys are the card line\'s &N',
  'domain.list.art.sidecarBadEntry': 'card {cardId}: {reason}',
  // ── Front matter ──────────────────────────────────────────────────────
  'domain.list.frontMatter.notMapping':
    'Front matter is not a key/value mapping, so its content was ignored (the block itself is preserved on save).',
  'domain.list.frontMatter.invalidYaml':
    'Front matter could not be read as YAML, so its keys were ignored (the block itself is preserved on save): {detail}',
  'domain.list.frontMatter.labelsIgnored': "Front matter 'labels' ignored: {reason}",
  'domain.list.metadata.frontMatterUnreadable': {
    $select: 'reason',
    notAMapping:
      "The file's front matter is not a key/value mapping, so a metadata write would overwrite it. Fix the block by hand first.",
    invalidYaml:
      "The file's front matter could not be read as YAML, so a metadata write would overwrite it. Fix the block by hand first.",
  },

  // ── The cover image on disk ───────────────────────────────────────────
  'domain.list.image.frontMatterUnreadable': {
    $select: 'reason',
    notAMapping:
      "The file's front matter is not a key/value mapping, so a list image write would overwrite it. Fix the block by hand first.",
    invalidYaml:
      "The file's front matter could not be read as YAML, so a list image write would overwrite it. Fix the block by hand first.",
  },
  'domain.list.image.fileUnreadable':
    'The list file could not be read, so any list image it names was ignored: {error}',
  'domain.list.image.notMappingIgnored':
    'Front matter is not a key/value mapping, so any list image it names was ignored.',
  'domain.list.image.invalidYamlIgnored':
    'Front matter could not be read as YAML, so any list image it names was ignored: {detail}',
  'domain.list.image.cardNotInList':
    'image references card &{card}, which is not a card in this list.',

  // ── Deck formats ──────────────────────────────────────────────────────
  'domain.list.deckFormat.invalid': "Invalid deck format '{format}'. Valid formats: {formats}",

  // ── List names, create / rename / delete ──────────────────────────────
  'domain.list.name.unusable': "'{name}' contains no characters usable in a file name.",
  'domain.list.lifecycle.exists': {
    $select: 'type',
    deck: "A deck named '{name}' already exists.",
    collection: "A collection named '{name}' already exists.",
    wanted: "A wanted list named '{name}' already exists.",
  },
  'domain.list.lifecycle.existsFolded': {
    $select: 'type',
    deck: "A deck named '{name}' already exists (it matches '{query}' under list-name folding).",
    collection:
      "A collection named '{name}' already exists (it matches '{query}' under list-name folding).",
    wanted:
      "A wanted list named '{name}' already exists (it matches '{query}' under list-name folding).",
  },
  'domain.list.lifecycle.invalidName': {
    $select: 'type',
    deck: 'Invalid deck name.',
    collection: 'Invalid collection name.',
    wanted: 'Invalid wanted list name.',
  },
  'domain.list.lifecycle.notFound': {
    $select: 'type',
    deck: "Deck '{name}' not found.",
    collection: "Collection '{name}' not found.",
    wanted: "Wanted list '{name}' not found.",
  },
  'domain.list.lifecycle.confirmMismatch': "Confirmation name does not match. Expected '{name}'.",

  // ── The whole-file-rewrite gate ───────────────────────────────────────
  'domain.list.fencedContent': {
    $plural: 'count',
    one: 'Fenced code block content ({count} line) — read as prose, but a whole-file rewrite would delete it',
    other:
      'Fenced code block content ({count} lines) — read as prose, but a whole-file rewrite would delete it',
  },
  'domain.list.unreadableContent': {
    $select: 'action',
    saving:
      '{file} holds content the parser cannot re-emit, and saving would delete it (releasing any &N ids it carries). Fix the file first — {problems}',
    moving:
      '{file} holds content the parser cannot re-emit, and moving would delete it (releasing any &N ids it carries). Fix the file first — {problems}',
    appending:
      '{file} holds content the parser cannot re-emit, and appending would delete it (releasing any &N ids it carries). Fix the file first — {problems}',
  },

  // ── Cross-list moves ──────────────────────────────────────────────────
  'domain.list.move.destinationNotFound': 'Cannot move "{name}": destination {list} not found',
  'domain.list.move.sourceNotFound': 'Cannot move "{name}": source {list} not found',
  'domain.list.move.sourceCopyNotFound':
    'Cannot move "{name}" from {list}: no matching copy found there',
  'domain.list.move.artUnfiled':
    'the custom art of "{name}" (moved from {list}) has no destination line to follow onto',
  'domain.list.move.cannotReadDeck': 'Cannot read deck file: {file}',
  'domain.list.move.cannotReadFile': 'Cannot read file: {file}',
  'domain.list.move.abortDestinationMissing': 'Destination file not found, aborting move: {file}',
  'domain.list.move.abortSourceUnreadable': 'Source file not readable, aborting move: {file}',
  'domain.list.move.abortRemoveSourceUnreadable':
    'Source file not readable, aborting remove: {file}',
  'domain.list.move.abortMove': 'Aborting move: {reason}',
  'domain.list.move.abortRemove': 'Aborting remove: {reason}',
  'domain.list.move.appendIntoOpenFence':
    'Cannot add "{name}": the destination file ends inside an unclosed code fence, so the new card line would be read as prose. Close the fence first.',

  // ── The &N backfill ───────────────────────────────────────────────────
  'domain.list.idBackfill.readFailed': 'ensure-card-ids: failed to read {path}: {error}',

  // ── Engine guards (a caller bug, never a user mistake) ────────────────
  'domain.list.guard.unhandledAction':
    "applyTargetedChanges does not handle '{action}' events; use the editor engines.",
  'domain.list.guard.deckOnlyAction': {
    $select: 'type',
    collection: "applyTargetedChanges cannot apply '{action}' to a collection",
    wanted: "applyTargetedChanges cannot apply '{action}' to a wanted list",
  },
  'domain.list.guard.unsupportedLabels':
    'applyTargetedChanges cannot apply this set-label: {reason}',
  'domain.list.guard.noCopies':
    'applyDeckAddToContent needs at least one copy to add (got {copies}).',
  'domain.list.guard.noCardId': 'applyDeckAddToContent produced no card id',
  'domain.list.guard.moveEvents':
    'applyChangesToCollectionFile does not handle move events; use the move engine.',
  'domain.list.guard.commitTwice': 'PreparedMoves.commit() is single-use',
} as const satisfies MessageCatalogShape
