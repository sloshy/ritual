/**
 * `cli.*` messages for one-shot card commands (add / remove / set / note / move) and the card-lookup surfaces.
 *
 * A fragment of the cli namespace, split out purely so the command surfaces can
 * be converted independently without contending for one file. Every key still
 * begins with `cli.`, and a translator sees one flat catalog.
 *
 * Two conventions run through this fragment:
 *
 * - **`$select` on a list type** rather than a `{type}` noun spliced into one
 *   sentence. The noun is gendered in most target languages, so the article and
 *   every agreeing word in the sentence changes with it.
 * - **`$select` on `mode`** (`done` / `preview`) rather than a spliced verb. A
 *   dry run reports what *would* happen, which is a different sentence — and in
 *   English it also carries the `[dry-run]` marker, which stays as-is.
 */

import type { MessageCatalogShape } from '../../types'

export const cliCardsMessages = {
  // ── Shared by every one-shot card command ─────────────────────────────
  'cli.cardOps.cancelled': 'Cancelled.',
  'cli.cardOps.pinNeedsBoth': '--set and --collector-number must be given together.',
  'cli.cardOps.wantedNoCondition':
    'Wanted list entries do not track condition — --condition applies to decks and collections only.',
  'cli.cardOps.labelCollectionsOnly': '--label only applies to collections.',
  'cli.cardOps.cardIdPositive': "--card-id must be a positive integer (got '{value}').",
  'cli.cardOps.quantityPositive': "--quantity must be a positive integer (got '{value}').",
  'cli.cardOps.oneTypeFlag': 'Specify only one of --deck, --collection, or --wanted.',
  'cli.cardOps.noListFiles': 'No decks, collections, or wanted lists found. Create one first.',
  'cli.cardOps.noListFilesOfType': {
    $select: 'type',
    deck: 'No deck files found. Create one first.',
    collection: 'No collection files found. Create one first.',
    wanted: 'No wanted list files found. Create one first.',
  },
  'cli.cardOps.promptSelectList': 'Select a list:',
  'cli.cardOps.listChoice': '{name} — {type}',
  'cli.cardOps.promptSelectCard': 'Select a card:',
  'cli.cardOps.cardChoiceWithNote': '{entry} — note: "{note}"',
  'cli.cardOps.selectionOutOfRange': 'Selection out of range.',
  'cli.cardOps.typeLabel': {
    $select: 'type',
    deck: 'Deck',
    collection: 'Collection',
    wanted: 'Wanted list',
  },
  'cli.cardOps.listEmpty': {
    $select: 'type',
    deck: 'Deck is empty.',
    collection: 'Collection is empty.',
    wanted: 'Wanted list is empty.',
  },
  'cli.cardOps.noCardWithId': 'No card with id {id} found in {file}.',
  'cli.cardOps.noCardMatching': "No card matching '{name}' found in {file}.",
  'cli.cardOps.ambiguousCard':
    "Multiple cards match '{name}'. Pick one with --card-id <id> or run interactively:\n{matches}",
  'cli.cardOps.matchLine': '  - {entry}',
  'cli.cardOps.andMore': '  ... and {count} more',
  'cli.cardOps.cardIdNameMismatch':
    "--card-id {cardId} is '{entryName}', which does not match '{requestedName}'. Pass one selector or the other.",
  'cli.cardOps.noCachedPrintingList':
    "The card cache holds no printing list for '{name}'. Run 'ritual cache preload-all' to download it.",
  'cli.cardOps.verifyPrintingFailed': 'Failed to verify printing {printing}: {reason}. {advice}',
  'cli.cardOps.printingUnverified':
    "Could not verify printing {printing} of '{name}' with Scryfall. {advice}",
  'cli.cardOps.printingIsOther': "{printing} is '{actual}', not '{name}'.",
  'cli.cardOps.printingLookupFailed': "Failed to look up printings for '{name}': {reason}",
  'cli.cardOps.languageUnavailable':
    "Printing {printing} of '{name}' is not available in {language} ({code}). Available languages: {available}.",
  'cli.cardOps.noLanguageObject':
    "Scryfall has no {language} ({code}) object for printing {printing} of '{name}'.",
  'cli.cardOps.finishCarriedOver':
    '{reason} The entry already records {finish}; pass --finish to record an available one.',
  'cli.cardOps.dryRunLine': '[dry-run] {line}',

  // ── Refused prompts (`--no-input`) ────────────────────────────────────
  //
  // Noun phrases, never questions: they are interpolated into the declarative
  // frame `errors.input.required`. See `src/no-input.ts`.
  'cli.prompt.subject.wantedAdd':
    'wanted-list adds are interactive by default — pass --name-only, --specific, or --set/--collector-number',
  'cli.prompt.subject.fullCardName':
    "pass the full card name — '{name}' does not exactly match a cached card name, and the card picker cannot open",

  // ── add-card ──────────────────────────────────────────────────────────
  'cli.addCard.invalidCondition':
    "Invalid condition '{value}'. Use one of: {choices}, or NONE to record no condition.",
  'cli.addCard.quantityPositive': 'Quantity must be a positive integer.',
  'cli.addCard.collectorNumberEmpty': 'Collector number cannot be empty.',
  'cli.addCard.cacheUnavailable': 'Card cache is not available.',
  'cli.addCard.loadedFromCache': 'Loaded {count} cards from cache.',
  'cli.addCard.wantedOnlyFlags': '--name-only and --specific apply only to wanted list targets.',
  'cli.addCard.deckOnlyFlags': '--section and --commander apply only to deck targets.',
  'cli.addCard.quantityDeckOnly':
    '--quantity applies only to deck targets (collection and wanted entries are one physical card per line).',
  'cli.addCard.changelogNotAList': "'{name}' is a changelog file and cannot be used as a list.",
  'cli.addCard.deckNotFound':
    "No deck named '{name}' found. Create it first with 'ritual new deck'.",
  'cli.addCard.noExactMatch': "No exact match for '{name}'. {matches}",
  'cli.addCard.exactMatchFound': 'Exact match found: {name}',
  'cli.addCard.noCardsMatching': "No cards found matching '{name}'.",
  'cli.addCard.foundMatching': "Found {counted} matching '{name}'.",
  'cli.addCard.addedToDeck': {
    $select: 'mode',
    done: "Added '{card}' to {file} ({section})",
    preview: "Would add '{card}' to {file} ({section})",
  },
  'cli.addCard.addedLine': {
    $select: 'mode',
    done: 'Added: {line}',
    preview: 'Would add: {line}',
  },
  'cli.addCard.noPrintingSelected':
    "No printing selected for '{name}'. Pass --set and --collector-number to pin one.",
  'cli.addCard.noPrintingResolved':
    "Could not resolve a printing for '{name}'. Pass --set and --collector-number, or use --name-only.",
  'cli.addCard.promptSpecificity': 'How specific for {name}?',
  'cli.addCard.specificityNameOnly': 'Name only (any copy)',
  'cli.addCard.specificityChoosePrinting': 'Choose specific printing',

  // ── remove-card ───────────────────────────────────────────────────────
  'cli.removeCard.quantityAllCopiesExclusive':
    '--quantity and --all-copies are mutually exclusive.',
  'cli.removeCard.allCopiesDeckOnly': {
    $select: 'type',
    collection:
      '--all-copies only applies to decks — each collection entry is one physical card. Remove other copies individually (disambiguate with --card-id).',
    wanted:
      '--all-copies only applies to decks — each wanted list entry is one physical card. Remove other copies individually (disambiguate with --card-id).',
  },
  'cli.removeCard.quantityDeckOnly': {
    $select: 'type',
    collection:
      '--quantity only applies to decks — each collection entry is one physical card. Remove other copies individually (disambiguate with --card-id).',
    wanted:
      '--quantity only applies to decks — each wanted list entry is one physical card. Remove other copies individually (disambiguate with --card-id).',
  },
  'cli.removeCard.tooManyCopies': {
    $plural: 'count',
    one: "Cannot remove {count} copy of '{name}' — the deck has {available}.",
    other: "Cannot remove {count} copies of '{name}' — the deck has {available}.",
  },
  'cli.removeCard.removed': {
    $select: 'mode',
    done: 'Removed {count} x {entry} from {list} ({remaining} remaining)',
    preview: '[dry-run] Would remove {count} x {entry} from {list} ({remaining} remaining)',
  },

  // ── set-card ──────────────────────────────────────────────────────────
  'cli.setCard.invalidCondition':
    "Invalid condition '{value}'. Use one of: {choices}, or NONE to clear the recorded condition.",
  'cli.setCard.labelWithNone': "{reason} Or pass 'none' to clear the override.",
  'cli.setCard.languageFlagHint': '(en clears the token)',
  'cli.setCard.conditionCleared': 'condition → none (grade cleared)',
  'cli.setCard.conditionDefault':
    'condition → NM (written as an ungraded line — NM is the default)',
  'cli.setCard.conditionSet': 'condition → {condition}',
  'cli.setCard.languageCleared': 'language → en (token cleared — a bare line means English)',
  'cli.setCard.languageSet': 'language → {code} ({language})',
  'cli.setCard.finishCheckUnknownPrinting':
    "Note: could not verify finish '{finish}' for {entry} — {printing} is not a known printing of '{name}'.",
  'cli.setCard.finishCheckCacheMiss':
    "Note: could not verify finish '{finish}' for {entry} — the card cache holds no complete printing list for it. Run 'ritual cache preload-all' to enable the check.",
  'cli.setCard.noChangeGiven':
    'Specify at least one change: --set/--collector-number, --finish, --condition, --language, --label, --section, --commander, or --no-commander.',
  'cli.setCard.sectionDecksOnly': '--section only applies to decks.',
  'cli.setCard.commanderDecksOnly': '--commander/--no-commander only apply to decks.',
  'cli.setCard.languageUnverified':
    'Note: could not verify that {printing} exists in {language} ({code}) — Scryfall could not be reached{detail}. Recording it as asserted.',
  'cli.setCard.reasonSuffix': ': {reason}',
  'cli.setCard.appliedPrinting': 'printing → {printing}',
  'cli.setCard.appliedFinish': 'finish → {finish}',
  'cli.setCard.labelCleared': 'label → none (list default)',
  'cli.setCard.appliedLabel': 'label → {labels}',
  'cli.setCard.appliedSection': 'section → {section}',
  'cli.setCard.appliedCommander': 'commander',
  'cli.setCard.appliedNotCommander': 'not commander',
  'cli.setCard.updated': {
    $select: 'mode',
    done: 'Updated {entry} in {list}: {changes}',
    preview: '[dry-run] Would update {entry} in {list}: {changes}',
  },

  // ── note ──────────────────────────────────────────────────────────────
  'cli.note.set': {
    $select: 'mode',
    done: 'Set note on {name}{id} to "{note}"',
    preview: '[dry-run] Would set note on {name}{id} to "{note}"',
  },
  'cli.note.nothingToClear': {
    $select: 'mode',
    done: 'No note on {name}{id}; nothing to clear.',
    preview: '[dry-run] No note on {name}{id}; nothing to clear.',
  },
  'cli.note.cleared': {
    $select: 'mode',
    done: 'Cleared note on {name}{id}',
    preview: '[dry-run] Would clear note on {name}{id}',
  },
  'cli.note.promptReplace': 'Replace note (current: "{current}"):',
  'cli.note.promptText': 'Note text:',
  'cli.note.emptyNote': 'Note text cannot be empty. Use --clear to remove a note.',

  // ── card ──────────────────────────────────────────────────────────────
  'cli.card.stdinOrFile': 'Use either --stdin or --from-file, not both.',
  'cli.card.readFailed': "Could not read file '{file}': {reason}",
  'cli.card.nameRequired':
    'Provide a card name argument or use --stdin/--from-file for batch input.',
  'cli.card.fetchFailed': "Failed to fetch card '{name}': {reason}",
  'cli.card.notFound': "Card '{name}' not found.",

  // ── scry ──────────────────────────────────────────────────────────────
  'cli.scry.pagesWithRandom': '--pages cannot be used with --random.',
  'cli.scry.csvWithRandom': '--output csv cannot be used with --random.',
  'cli.scry.countNeedsRandom': '--count requires --random.',
  'cli.scry.queryRequired': 'A search query is required unless --random is given.',
  'cli.scry.fieldsWithCsv': '--fields cannot be used with --output csv.',
  'cli.scry.pageFetchFailed': 'Error fetching page {page}: {reason}',
  'cli.scry.noResults': 'No results found.',
  'cli.scry.promptNextPage': 'Page {page} displayed. Fetch next page?',
  'cli.scry.truncatedUnknown': 'More results remain (fetched {pages}); use --pages <n> for more.',
  'cli.scry.truncated': 'Fetched {fetched} of {total} results ({pages}); use --pages <n> for more.',
  'cli.scry.randomFailed': 'Failed to fetch random card: {reason}',
  'cli.scry.randomNotFound': 'No card found for the supplied random filter.',
  'cli.scry.pagesPositive': 'Pages must be a positive integer.',
  'cli.scry.pagesTooLarge': 'Pages must be at most {max}.',
  'cli.scry.countPositive': 'Count must be a positive integer.',
  'cli.scry.countTooLarge': 'Count must be at most {max}.',

  // ── diff ──────────────────────────────────────────────────────────────
  'cli.diff.invalidMode': "Invalid mode '{value}'. Use 'name' or 'printing'.",
  'cli.diff.identical': 'Lists are identical by {by}.',
  'cli.diff.noPrinting': 'no printing',
  'cli.diff.onlyInHeading': 'Only in {list} ({count})',
  'cli.diff.quantityHeading': 'Different quantities ({count})',
  'cli.diff.onlyLine': '  {quantity} {card}',
  'cli.diff.mismatchLine': '  {card}: {aQuantity} in {aList}, {bQuantity} in {bList}',
  'cli.diff.warningLine': '⚠️  {warning}',

  // ── move ──────────────────────────────────────────────────────────────
  'cli.move.indexWarning': 'Warning: {warning}',
  'cli.move.menuViewPending': '📋 View Pending Changes',
  'cli.move.menuViewPendingCount': '📋 View Pending Changes ({count})',
  'cli.move.menuFilters': '⚙️  Configure Session Filters',
  'cli.move.menuExit': '🚪 Exit',
  'cli.move.toRequiresFrom': '--to requires --from. Pass both to script a move.',
  'cli.move.scriptedNeedsBoth':
    'Scripted moves need both --from and --to. Run `ritual move` without card arguments for the interactive session.',
  'cli.move.loadingLists': 'Loading all lists...',
  'cli.move.noLists': 'No list files found. Create a deck, collection, or wanted list first.',
  'cli.move.sourceNotLoaded': 'Source list not found among loaded lists.',
  'cli.move.loadingCards': 'Loading cards...',
  'cli.move.noCards': 'No cards found in any list.',
  'cli.move.sourceFilter': 'Source filter: {list} (widen it under Session Filters).',
  'cli.move.ready': 'Ready. {cards} across {lists}.',
  'cli.move.promptSearch': 'Search for a card to move, or choose an option:',
  'cli.move.selectorRequired': 'Provide a card name or --card-id to select the card to move.',
  'cli.move.sameList': 'Source and destination are the same list.',
  'cli.move.toSectionEmpty': '--to-section cannot be empty.',
  'cli.move.toSectionDeckOnly': '--to-section requires a deck destination.',
  'cli.move.listNotLoaded': 'A resolved list could not be loaded.',
  'cli.move.noteDroppedWarning':
    'Warning: note on "{name}"{id} was dropped (merged onto an existing line): {note}',
  'cli.move.noteDroppedLine':
    '  ⚠ Note on "{name}"{id} was dropped (merged onto an existing line): {note}',
  'cli.move.noCardWithId': 'No card with id {id} found in {list}.',
  'cli.move.noCardMatching': "No card matching '{name}' found in {list}.",
  'cli.move.noCopiesMatching': "No copies of '{name}' matching {criteria} found in {list}.",
  'cli.move.multiplePrintings':
    'Multiple printings match in {list}. Narrow with --set, --collector-number, --finish, or --card-id:\n{matches}',
  'cli.move.criteriaSet': 'set {set}',
  'cli.move.criteriaCollectorNumber': 'collector number {value}',
  'cli.move.criteriaFinish': 'finish {finish}',
  'cli.move.printingNeedsBoth':
    "'{name}' has no printing; pass both --set and --collector-number to assign one for the collection destination.",
  'cli.move.printingsUnknown':
    "No printings of '{name}' are known from the card cache, so its printing can't be determined. Pass --set and --collector-number to assign one for the collection destination, or run 'ritual cache preload-all'.",
  'cli.move.multipleCardPrintings':
    "'{name}' has multiple printings. Pick one with --set and --collector-number:\n{printings}",
  'cli.move.printingLine': '  - {setName} ({printing})',
  'cli.move.moved': 'Moved {count} x {card} from {from} to {to}',
  'cli.move.noPending': 'No pending moves.',
  'cli.move.saving': {
    $plural: 'count',
    one: 'Saving {count} move...',
    other: 'Saving {count} moves...',
  },
  'cli.move.doneMoved': {
    $plural: 'count',
    one: 'Done. Moved {count} card.',
    other: 'Done. Moved {count} cards.',
  },
  'cli.move.pendingHeading': 'Pending moves ({count}):',
  'cli.move.pendingLine': '  {card}: {from} → {to}',
  'cli.move.noDestinations':
    'No valid destinations available. Configure destinations in session filters.',
  'cli.move.promptDestination': 'Move "{name}" to:',
  'cli.move.needsPrinting':
    '"{name}" has no printing info. Resolve printing for collection destination.',
  'cli.move.printingCancelled': 'Printing selection cancelled.',
  'cli.move.noPrintingsFound': 'No printings found for "{name}"; cannot move it to a collection.',
  'cli.move.queued': '  ✓ Queued: {card} → {list}',
  'cli.move.filtersPrompt': 'Session Filters:',
  'cli.move.configureSources': 'Configure Sources (which lists to move cards FROM)',
  'cli.move.configureDestinations': 'Configure Destinations (which lists to move cards TO)',
  'cli.move.back': '← Back',
  'cli.move.done': '← Done',
  'cli.move.toggleListsPrompt': {
    $select: 'direction',
    from: 'Move FROM — Toggle Lists:',
    to: 'Move TO — Toggle Lists:',
  },
  'cli.move.toggleGroupDecks': '[{state}] Decks ({enabled}/{total})',
  'cli.move.toggleGroupCollections': '[{state}] Collections ({enabled}/{total})',
  'cli.move.toggleGroupWanted': '[{state}] Wanted Lists ({enabled}/{total})',
  'cli.move.toggleAllOn': '── Toggle All ON ──',
  'cli.move.toggleAllOff': '── Toggle All OFF ──',
  'cli.move.toggleItem': '[{state}] {name}',
  'cli.move.categoryPrompt': '{category}:',
  'cli.move.keepOneDestination': 'At least one destination must remain enabled.',
  'cli.move.finishFoil': ' [Foil]',
  'cli.move.finishEtched': ' [Etched]',
  'cli.move.listUnreadable':
    '{file}: could not be read or parsed; its cards are missing from the index.',
  'cli.move.listWarning': '{file}: {warning}',
  'cli.move.destinationNotFound': 'Cannot move "{name}": destination {list} not found',
  'cli.move.abortDestinationMissing': 'Destination file not found, aborting move: {file}',
  'cli.move.abortSourceUnreadable': 'Source file not readable, aborting move: {file}',
  'cli.move.abortMove': 'Aborting move: {reason}',
  'cli.move.abortRemoveSourceUnreadable': 'Source file not readable, aborting remove: {file}',
  'cli.move.abortRemove': 'Aborting remove: {reason}',
  'cli.move.cannotReadDeck': 'Cannot read deck file: {file}',
  'cli.move.cannotReadFile': 'Cannot read file: {file}',
  'cli.move.collectionNeedsPrinting':
    'Cannot add "{name}" to a collection without set and collector number',
  'cli.move.appendIntoOpenFence':
    'Cannot add "{name}": the destination file ends inside an unclosed code fence, so the new card line would be read as prose. Close the fence first.',

  // ── List lifecycle: new / rename / delete ─────────────────────────────
  'cli.new.invalidType': "Invalid list type '{value}'. Use 'deck', 'collection', or 'wanted'.",
  'cli.new.formatDecksOnly': '--format only applies to decks.',
  'cli.new.created': {
    $select: 'type',
    deck: 'Created deck: {file}',
    collection: 'Created collection: {file}',
    wanted: 'Created wanted list: {file}',
  },
  'cli.rename.renamed': {
    $select: 'type',
    deck: "Renamed deck '{oldName}' to '{name}' ({file})",
    collection: "Renamed collection '{oldName}' to '{name}' ({file})",
    wanted: "Renamed wanted list '{oldName}' to '{name}' ({file})",
  },
  'cli.delete.deleted': {
    $select: 'type',
    deck: "Deleted deck '{name}'",
    collection: "Deleted collection '{name}'",
    wanted: "Deleted wanted list '{name}'",
  },
  'cli.delete.notice': {
    $select: 'type',
    deck: "About to delete deck '{name}' ({file}) and its sidecar files.",
    collection: "About to delete collection '{name}' ({file}) and its sidecar files.",
    wanted: "About to delete wanted list '{name}' ({file}) and its sidecar files.",
  },
  'cli.delete.promptConfirm': "Type '{name}' to confirm:",

  // ── lists / list-all-cards ────────────────────────────────────────────
  'cli.lists.empty': '(no lists)',
  'cli.listAllCards.warning': 'warning: {warning}',
  'cli.listAllCards.skipped': 'warning: skipped {file}: {reason}',
  'cli.listAllCards.wrote': 'Wrote {count} cards to {target}',
  'cli.listAllCards.writeFailed': 'Failed to write {file}: {reason}',

  // ── metadata ──────────────────────────────────────────────────────────
  'cli.metadata.rejectedName':
    "name cannot be set here — a list's display name is changed with ritual rename, which also renames the file and its sidecars.",
  'cli.metadata.rejectedCreated':
    'created is stamped when the deck is created and cannot be edited.',
  'cli.metadata.rejectedLastSynced': 'lastSynced is stamped by deck sync and cannot be edited.',
  'cli.metadata.unknownField': {
    $select: 'type',
    deck: "Unknown metadata field '{property}'. Accepted fields for a deck: {keys}.",
    collection: "Unknown metadata field '{property}'. Accepted fields for a collection: {keys}.",
  },
  'cli.metadata.wantedNoMetadata':
    'Wanted lists carry no metadata. Use ritual rename to change the display name.',
  'cli.metadata.frontMatterUnreadable': {
    $select: 'reason',
    notAMapping: "The file's front matter is not a key/value mapping. Fix the block by hand first.",
    invalidYaml: "The file's front matter could not be read as YAML. Fix the block by hand first.",
  },
  'cli.metadata.storedLabelsInvalid': "The stored 'labels' value is invalid: {reason}",
  'cli.metadata.arrayOnlyDeck': "--add/--remove apply to array properties (a deck's: tags).",
  'cli.metadata.arrayOnlyCollection':
    "--add/--remove apply to array properties (a collection's: labels).",
  'cli.metadata.singleValue': '{property} takes exactly one value.',
  'cli.metadata.invalidLabel': "Invalid label '{value}'. Use one of: {choices}.",
  'cli.metadata.noLabels': 'No labels given. To clear the default, use ritual metadata unset.',
  'cli.metadata.set': {
    $select: 'type',
    deck: "Set {property} = {value} on deck '{list}'",
    collection: "Set {property} = {value} on collection '{list}'",
  },
  'cli.metadata.cleared': {
    $select: 'type',
    deck: "Cleared {property} on deck '{list}'",
    collection: "Cleared {property} on collection '{list}'",
  },
  'cli.metadata.unset': {
    $select: 'type',
    deck: "Unset {property} on deck '{list}'",
    collection: "Unset {property} on collection '{list}'",
  },
  'cli.metadata.notSet': {
    $select: 'type',
    deck: '"{property}" is not set on deck \'{list}\'.',
    collection: '"{property}" is not set on collection \'{list}\'.',
  },
  'cli.metadata.row': '{key} = {value}',
  'cli.metadata.rowUnset': '{key} = (unset)',

  // ── cleanup ───────────────────────────────────────────────────────────
  'cli.cleanup.couldNotRead': 'could not be read: {reason}',
  'cli.cleanup.skipped': 'skipped: fix the file and rerun cleanup',
  'cli.cleanup.notRenamedOccupied': "not renamed to '{file}': another list already has that file",
  'cli.cleanup.notRenamedCollision': "not renamed to '{file}': {reason}",
  'cli.cleanup.notRewritten': 'not rewritten: fix the lines above and rerun cleanup',
  'cli.cleanup.actionFormatSet': 'format set to {format}',
  'cli.cleanup.actionRenamed': "renamed to '{file}'",
  'cli.cleanup.actionRewritten': 'rewritten in canonical form',
  'cli.cleanup.actionNeedsFormat': 'needs a format',
  'cli.cleanup.actionFormatSkipped': 'format skipped',
  'cli.cleanup.actionNoFormat': 'left without a format',
  'cli.cleanup.signalCommandZone':
    "Deck '{name}' has no format — a commander was detected, so command-zone formats are listed first.",
  'cli.cleanup.signalConstructed':
    "Deck '{name}' has no format — {count} cards with no commander, so 60-card constructed formats are listed first.",
  'cli.cleanup.signalLimited':
    "Deck '{name}' has no format — {count} cards with no commander suggests Limited (sealed or draft).",
  'cli.cleanup.signalNone': "Deck '{name}' has no format.",
  'cli.cleanup.formatlessDecks': {
    $plural: 'count',
    one: '{count} deck has no format and prompts are unavailable ({names}). Re-run with --skip-formats to leave it untouched, or run interactively to choose formats.',
    other:
      '{count} decks have no format and prompts are unavailable ({names}). Re-run with --skip-formats to leave them untouched, or run interactively to choose formats.',
  },
  'cli.cleanup.fileLine': '{prefix}{file}: {actions}',
  'cli.cleanup.fileWarning': '{prefix}{file}: warning: {warning}',
  'cli.cleanup.noListFiles': 'No list files found.',
  'cli.cleanup.allClean': 'Checked {counted}; everything is already clean.',
  'cli.cleanup.summary': {
    $select: 'mode',
    done: 'Cleaned up {changed} of {counted}.',
    preview: 'Would clean up {changed} of {counted}.',
  },

  // ── get-primer ────────────────────────────────────────────────────────
  'cli.getPrimer.userAgentRequired':
    'Error: Moxfield URL sources require a unique Moxfield-approved user agent string. Set MOXFIELD_USER_AGENT or pass --moxfield-user-agent <agent>.',
  'cli.getPrimer.noPrimerFetched': 'No primer found for this deck.',
  'cli.getPrimer.readFailed': "Failed to read deck file '{file}':",
  'cli.getPrimer.noPrimer': "Deck '{name}' has no primer (.primer.md sidecar).",

  // ── Ambiguous collection-sync removals ────────────────────────────────
  'cli.resolveAmbiguity.priorityAdvice':
    'Pass --removal-priority <list> (repeatable, in priority order) to say which lists may lose copies, or run in a terminal to resolve them one by one.',
  'cli.resolveAmbiguity.leftUnresolved': '{counted} left unresolved. {advice}',
  'cli.resolveAmbiguity.copiesLiveIn': '{card}: {count} to remove — copies live in {lists}.',
  'cli.resolveAmbiguity.promptWhichList': 'Which list lost {card}? (copy {copy} of {total})',
  'cli.resolveAmbiguity.listChoice': '{name} ({left} left)',
  'cli.resolveAmbiguity.cancelledAfter': 'Cancelled after {done} of {total} copies of {card}.',
} as const satisfies MessageCatalogShape
