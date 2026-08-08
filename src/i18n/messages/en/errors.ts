/**
 * `errors.*` — user-facing failure prose. The machine contract is untouched:
 * exit codes and `ErrorCode` never move, and `--output json` keeps its stable
 * `error.code` alongside the new locale-invariant `error.messageKey`.
 */

import type { MessageCatalogShape } from '../../types'

export const errorMessages = {
  'errors.input.required': 'Input required: {subject} ({reason}).',
  'errors.enum.invalid': "Invalid {field} '{value}'. Use one of: {choices}.",
  'errors.enum.type': '{field} must be one of: {choices}.',
  'errors.skills.unknown': {
    $plural: 'count',
    one: 'Unknown skill: {names}. Available: {available}',
    other: 'Unknown skills: {names}. Available: {available}',
  },

  // ── Scripting envelope ────────────────────────────────────────────────
  'errors.scripting.fieldsNeedStructuredOutput':
    '--fields requires --output json or --output ndjson.',
  'errors.scripting.fieldsEmpty': 'Expected at least one field for --fields.',
  'errors.scripting.portRange': 'Port must be an integer between 1 and 65535.',

  // ── List resolution ───────────────────────────────────────────────────
  //
  // One of the single-function multipliers: `formatResolveListError` is the only
  // renderer of these, and every command that takes a list name reaches it.
  //
  // The type-scoped variants are `$select` tables rather than one sentence with
  // a `{type}` noun spliced in. Splicing works in English and nowhere else: the
  // noun is gendered in most target languages, so the article and any agreeing
  // word in the sentence has to change with it.
  'errors.resolveList.noLists': 'No decks, collections, or wanted lists found.',
  'errors.resolveList.noListsOfType': {
    $select: 'type',
    deck: 'No decks found.',
    collection: 'No collections found.',
    wanted: 'No wanted lists found.',
  },
  'errors.resolveList.notFound': "No deck, collection, or wanted list named '{query}' found.",
  'errors.resolveList.notFoundOfType': {
    $select: 'type',
    deck: "No deck named '{query}' found.",
    collection: "No collection named '{query}' found.",
    wanted: "No wanted list named '{query}' found.",
  },
  'errors.resolveList.ambiguous':
    "'{query}' is ambiguous — it matches multiple lists:\n{matches}\n{advice}",
  'errors.resolveList.match': '  - {type}: {name}',
  'errors.resolveList.adviceNarrow': 'Type more of the name to narrow the match.',
  'errors.resolveList.adviceNarrowExample':
    "Type more of the name to narrow the match (e.g. '{name}').",
  'errors.resolveList.adviceExactName':
    "Type one list's exact full name, spelled and capitalized as its file is (e.g. '{name}').",
  'errors.resolveList.adviceTypeFlags': 'Disambiguate with --deck, --collection, or --wanted.',
  'errors.resolveList.adviceTypePrefix': 'Disambiguate with a type prefix, e.g. {prefixes}.',
  'errors.resolveList.adviceTypeField': "Set the list's type to {types}.",
  'errors.resolveList.typeConflict': {
    $select: 'type',
    deck: "'{query}' selects a deck, which conflicts with --{flag}. Drop the 'deck:' prefix or the --{flag} flag.",
    collection:
      "'{query}' selects a collection, which conflicts with --{flag}. Drop the 'collection:' prefix or the --{flag} flag.",
    wanted:
      "'{query}' selects a wanted list, which conflicts with --{flag}. Drop the 'wanted:' prefix or the --{flag} flag.",
  },
} as const satisfies MessageCatalogShape
