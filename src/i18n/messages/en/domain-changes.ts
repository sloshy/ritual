/**
 * `domain.changes.*` — the change engine's own text: why a change bundle, a
 * save request or a changelog event was refused, and why a save's changes did
 * not apply.
 *
 * A fragment of the domain namespace, registered by every surface: the CLI
 * (`ritual import-changes`, the one-shot edits), the admin server and MCP (the
 * import, save and history routes answer with these in English plus their
 * key), and both SPAs (the Import Changes page and the editors' import dialog
 * validate a bundle in the browser and word the refusal in the reader's
 * language).
 *
 * The validators that produce the problem codes sit inside the persistence
 * fence and never word anything; `src/changes/change-problem-message.ts` maps
 * each code to its key here. JSON field names, JSON paths, change actions,
 * list kinds (`deck`, `collection`, `wanted`) and the offending input values
 * are machine vocabulary and stay as they are inside the sentences that
 * mention them.
 */

import type { MessageCatalogShape } from '../../types'

export const domainChangesMessages = {
  // ── Change problems: the input as a whole ─────────────────────────────
  'domain.changes.problem.jsonInvalid': 'Not valid JSON.',
  'domain.changes.problem.jsonNotObject': 'Expected a JSON object.',
  'domain.changes.problem.bundleFormatMissing':
    'Not a ritual change bundle (missing "format": "{format}").',
  'domain.changes.problem.bundleVersionUnsupported':
    'Unsupported change-bundle version: {version}.',
  'domain.changes.problem.bundleFieldInvalid': 'Missing or invalid "{field}".',
  'domain.changes.problem.bundleArrayInvalid': 'Missing or invalid "{field}" array.',
  'domain.changes.problem.bundleLineBreak': 'A line break in "{path}".',
  'domain.changes.problem.bundleListNotObject': 'List #{list} is not an object.',
  'domain.changes.problem.bundleListKindInvalid':
    'List #{list}: Invalid list kind: {kind} (expected deck, collection, or wanted).',
  'domain.changes.problem.bundleListFieldInvalid': 'List #{list}: Missing or invalid "{field}".',
  'domain.changes.problem.bundleListArrayInvalid':
    'List #{list}: Missing or invalid "{field}" array.',
  'domain.changes.problem.bundleListFieldMalformed': 'List #{list}: Invalid "{field}".',
  'domain.changes.problem.saveChangesNotArray': '"changes" must be an array.',
  'domain.changes.problem.saveTooMany': {
    $plural: 'count',
    one: 'A save may carry at most {count} change (got {received}). Save in smaller batches.',
    other: 'A save may carry at most {count} changes (got {received}). Save in smaller batches.',
  },

  // ── Change problems: one change or move ───────────────────────────────
  //
  // Each sentence is a predicate of {subject}, the record it is about, rendered
  // from one of the `domain.changes.subject.*` keys below.
  'domain.changes.problem.notObject': '{subject} is not an object.',
  'domain.changes.problem.actionUnknown': '{subject} has an unknown action: {action}.',
  'domain.changes.problem.fieldMissing': '{subject} is missing its "{field}".',
  'domain.changes.problem.fieldInvalid': '{subject} has an invalid "{field}".',
  'domain.changes.problem.lineBreak': '{subject} has a line break in "{path}".',
  'domain.changes.problem.actionFieldMissing': '{subject} ({action}) is missing its "{field}".',
  'domain.changes.problem.categoryCardId':
    '{subject} ({action}) is keyed by card name and must not carry a "cardId".',
  'domain.changes.problem.listActionCardName':
    '{subject} ({action}) targets the list, not a card, and must not carry a "cardName".',
  'domain.changes.problem.printingHalf':
    '{subject} names half a printing; "set" and "collectorNumber" must both be present or both absent.',
  'domain.changes.problem.valueUnknown': {
    $select: 'field',
    language: '{subject} has an unknown language: {value}.',
    finish: '{subject} has an unknown finish: {value}.',
    condition: '{subject} has an unknown condition: {value}.',
    board: '{subject} has an unknown board: {value}.',
  },
  'domain.changes.problem.listTypeInvalid':
    '{subject} has an invalid list type: {value} (expected deck, collection, or wanted).',
  'domain.changes.problem.listKindInvalid':
    '{subject} has an invalid list kind: {value} (expected deck, collection, or wanted).',
  'domain.changes.problem.replacementCondition':
    '{subject} must not name a "condition" (a replacement carries no grade).',
  'domain.changes.problem.replacementPrintingMissing':
    '{subject} must name a printing ("set" and "collectorNumber").',
  'domain.changes.problem.replacementUnpinned':
    '{subject} carries a "replacement" but pins no line ("replacesCardId").',
  'domain.changes.problem.moveInChanges':
    '{subject} is a {action}; moves belong in the top-level "moves" array.',
  'domain.changes.problem.moveSameList': '{subject} names the same list as source and destination.',
  'domain.changes.problem.movePinWithoutTarget':
    '{subject} has a "pinsCardId" but no "toCardId"; a pinning move must name the line the copy lands on.',
  'domain.changes.problem.moveReplacementUnpinned':
    '{subject} has a "replacement" but no "pinsCardId"; only a pinning move carries one.',
  'domain.changes.problem.fieldRejected': '{subject}: {detail}',

  // ── Change problems: the record a problem is about ────────────────────
  'domain.changes.subject.change': 'The change',
  'domain.changes.subject.bundleChange': 'List #{list}: Change #{change}',
  'domain.changes.subject.bundleMove': 'Move #{move}',
  'domain.changes.subject.saveChange': 'changes[{index}]',
  'domain.changes.subject.historyEvent': 'Set #{set} event #{event}',
  'domain.changes.subject.part': '{subject} "{part}"',

  // ── Changes that did not apply ────────────────────────────────────────
  'domain.changes.unmatched.summary': '{reasons}. Nothing was saved.',
  'domain.changes.unmatched.noTarget': {
    $plural: 'count',
    one: '{count} change matched no card in {list}: {changes} — card names match exactly (case-sensitive)',
    other:
      '{count} changes matched no card in {list}: {changes} — card names match exactly (case-sensitive)',
  },
  'domain.changes.unmatched.notApplicable': {
    $plural: 'count',
    one: '{count} change never applies to {list}: {changes}',
    other: '{count} changes never apply to {list}: {changes}',
  },
  'domain.changes.unmatched.needsPrinting': {
    $plural: 'count',
    one: '{count} change would set a finish on a card with no printing: {changes} — set the printing first, then the finish',
    other:
      '{count} changes would set a finish on a card with no printing: {changes} — set the printing first, then the finish',
  },
  'domain.changes.unmatched.namedList': {
    $select: 'type',
    deck: 'deck "{slug}"',
    collection: 'collection "{slug}"',
    wanted: 'wanted "{slug}"',
  },
  'domain.changes.unmatched.listOfType': {
    $select: 'type',
    deck: 'a deck list',
    collection: 'a collection list',
    wanted: 'a wanted list',
  },
  'domain.changes.unmatched.quotedChange': '"{change}"',

  // ── Collection printing rule ──────────────────────────────────────────
  'domain.changes.collectionPrinting.add':
    'Cannot add "{name}" to a collection without set and collector number',
  'domain.changes.collectionPrinting.setPrinting':
    'Cannot set printing on "{name}" without set and collector number',
} as const satisfies MessageCatalogShape
