/**
 * `help.*` messages for one-shot card commands (add / remove / set / note / move) and the card-lookup surfaces.
 *
 * A fragment of the help namespace, split out purely so the command surfaces can
 * be converted independently without contending for one file. Every key still
 * begins with `help.`, and a translator sees one flat catalog.
 *
 * Flag names, argument placeholders (`<n>`, `<code>`), file extensions, and the
 * `deck:`/`collection:`/`wanted:` prefixes are all machine vocabulary: they
 * appear verbatim in these strings and never translate.
 */

import type { MessageCatalogShape } from '../../types'

export const helpCardsMessages = {
  // ── Shared across every list-addressing command ───────────────────────
  //
  // One entry per repeated string rather than one per command: these are
  // registered identically by `add-card`, `remove-card`, `set-card`, `note`,
  // `delete` and `rename`, so a translator writes them once.
  'help.listArg.crossType':
    'Name of the deck, collection, or wanted list (resolved across all types unless a type flag is given)',
  'help.listArg.prefixed':
    "Name of the list (optionally prefixed with 'deck:', 'collection:', or 'wanted:')",
  'help.listFlags.deck': 'Resolve the name as a deck',
  'help.listFlags.collection': 'Resolve the name as a collection',
  'help.listFlags.wanted': 'Resolve the name as a wanted list',
  'help.cardId.disambiguate': 'Disambiguate by card ID (the &N suffix in list files)',

  // ── add-card ──────────────────────────────────────────────────────────
  'help.addCard.description': 'Add a card to a deck, collection, or wanted list by name',
  'help.addCard.cardName': 'Name of the card to search for',
  'help.addCard.collectionFlag': 'Resolve the name as a collection (created if missing)',
  'help.addCard.wantedFlag': 'Resolve the name as a wanted list (created if missing)',
  'help.addCard.quantity': 'Number of copies to add (deck only)',
  'help.addCard.finish': 'Card finish: nonfoil, foil, etched',
  'help.addCard.condition':
    'Card condition: NM, LP, MP, HP, DMG, or NONE to record no condition (decks and collections only)',
  'help.addCard.language':
    "Card language (e.g. ja); overrides the configured defaultLanguage. Never prompted — en is a bare line's default",
  'help.addCard.label': 'Label the new card: sale,trade (combinable) or keep (collections only)',
  'help.addCard.section': 'Deck section to add to, created if missing (decks only)',
  'help.addCard.commander': "Add the card to the deck's Commander section (decks only)",
  'help.addCard.exact': 'Use exact matching (skip interactive selection if name matches)',
  'help.addCard.set': 'Pin an exact printing by set code (requires --collector-number)',
  'help.addCard.collectorNumber': 'Pin an exact printing by collector number (requires --set)',
  'help.addCard.nameOnly': 'Wanted lists: add the card by name without choosing a printing',
  'help.addCard.specific':
    'Wanted lists: record a specific printing (via --set/--collector-number or interactive selection)',
  'help.addCard.dryRun': 'Report what would be added without writing anything',

  // ── remove-card ───────────────────────────────────────────────────────
  'help.removeCard.description': 'Remove a card from a deck, collection, or wanted list',
  'help.removeCard.cardName': 'Name of the card to remove (fuzzy match)',
  'help.removeCard.quantity': 'Number of copies to remove (decks only)',
  'help.removeCard.allCopies': "Remove every copy on the card's line (decks only)",
  'help.removeCard.dryRun': 'Report what would be removed without writing anything',

  // ── set-card ──────────────────────────────────────────────────────────
  'help.setCard.description':
    "Update a card's printing, finish, condition, label, section, or commander status in place",
  'help.setCard.cardName': 'Name of the card to update (fuzzy match)',
  'help.setCard.set': 'New set code — requires --collector-number',
  'help.setCard.collectorNumber': 'New collector number — requires --set',
  'help.setCard.finish': 'New finish: {finishes}',
  'help.setCard.language':
    'New language (e.g. ja); en clears the token — a bare line means English. Recorded as its own change, even alongside --set/--collector-number',
  'help.setCard.condition':
    'New condition: {choices}, or NONE to clear it (decks and collections only)',
  'help.setCard.label':
    'New label override: sale,trade (combinable), keep, or none to clear it (collections only)',
  'help.setCard.section': 'Move the card to this section, created if missing (decks only)',
  'help.setCard.commander': 'Move the card to the Commander section (decks only)',
  'help.setCard.noCommander': 'Move the card out of the Commander section (decks only)',
  'help.setCard.dryRun': 'Report what would change without writing anything',

  // ── note ──────────────────────────────────────────────────────────────
  'help.note.description':
    'Set, replace, or clear the note on a card in a deck, collection, or wanted list',
  'help.note.cardName': 'Name of the card whose note to set or clear (fuzzy match)',
  'help.note.note': 'Note text (replaces any existing note). If omitted, you will be prompted.',
  'help.note.clear': 'Remove the note from the card',
  'help.note.dryRun': 'Report what the note would become without writing anything',

  // ── move ──────────────────────────────────────────────────────────────
  'help.move.description':
    'Move cards between decks, collections, and wanted lists — interactively, or scripted with --from/--to',
  'help.move.cardName': 'Card to move (fuzzy match; requires --from and --to)',
  'help.move.from':
    "Source list; accepts a 'deck:'/'collection:'/'wanted:' prefix. Alone, launches the interactive session filtered to this source",
  'help.move.to':
    'Destination list (same prefix convention). Together with --from, moves without prompts',
  'help.move.quantity': 'Number of copies to move (default 1)',
  'help.move.cardId': 'Select the source card by ID (the &N suffix in list files)',
  'help.move.set':
    'Narrow the match to this set code, or assign the printing when the card has none',
  'help.move.collectorNumber':
    'Narrow the match to this collector number, or assign the printing when the card has none',
  'help.move.finish': 'Narrow the match to this finish: {finishes}',
  'help.move.toSection':
    'Deck destinations only: add the card to this section (exact name, created if missing)',

  // ── card ──────────────────────────────────────────────────────────────
  'help.card.description': 'Look up a single card by name using Scryfall',
  'help.card.name': 'Card name to search for',
  'help.card.fuzzy': 'Use fuzzy matching instead of exact',
  'help.card.set': 'Filter by set code',
  'help.card.stdin': 'Read card names from stdin (one per line)',
  'help.card.fromFile': 'Read card names from file (one per line)',

  // ── scry ──────────────────────────────────────────────────────────────
  'help.scry.description': 'Run a raw Scryfall card search or fetch random cards',
  'help.scry.query': 'Scryfall search query (with --random, filters the random pick)',
  'help.scry.pages':
    'Fetch up to this many pages without prompting (default 1 when prompts are unavailable, max {max})',
  'help.scry.random': 'Fetch random cards instead of searching',
  'help.scry.count': 'Number of random cards to fetch with --random (default 1, max {max})',

  // ── diff ──────────────────────────────────────────────────────────────
  'help.diff.description': 'Compare two lists by card name or exact printing',
  'help.diff.listA': 'First list; an optional deck:/collection:/wanted: prefix pins the type',
  'help.diff.listB': 'Second list; an optional deck:/collection:/wanted: prefix pins the type',
  'help.diff.by': "Identity to compare by: 'name' or 'printing'",

  // ── List lifecycle: new / rename / delete ─────────────────────────────
  'help.new.description': 'Create a new deck, collection, or wanted list',
  'help.new.type': "List type: 'deck', 'collection', or 'wanted'",
  'help.new.name': 'Name of the list',
  'help.new.format':
    'Deck format (decks only; default: commander). Pass an invalid value to list every accepted format, or see the new command docs.',
  'help.rename.description': 'Rename a deck, collection, or wanted list',
  'help.rename.newName': 'New display name for the list',
  'help.delete.description': 'Delete a deck, collection, or wanted list and its sidecar files',
  'help.delete.confirm': "The list's display name, confirming the deletion",

  // ── lists / list-all-cards ────────────────────────────────────────────
  'help.lists.description': 'Enumerate every deck, collection, and wanted list',
  'help.lists.deck': 'Only list decks',
  'help.lists.collection': 'Only list collections',
  'help.lists.wanted': 'Only list wanted lists',
  'help.listAllCards.description':
    'Print a manifest of every unique card across decks, collections, and wanted lists. Useful as a deterministic cache key for CI builds.',
  'help.listAllCards.out':
    "Write the manifest to this file (relative to base dir) instead of stdout; '-' means stdout",

  // ── metadata ──────────────────────────────────────────────────────────
  'help.metadata.description':
    "Inspect and modify a list's front-matter metadata (deck description/tags/format/source link, collection default labels)",
  'help.metadata.set': 'Set or update a metadata property on a deck or collection',
  'help.metadata.get': 'Print the value of a single metadata property',
  'help.metadata.list': "Print a list's full front-matter metadata",
  'help.metadata.unset': 'Remove a metadata property from a deck or collection',
  'help.metadata.listName': 'Name of the deck or collection (prompted when omitted)',
  'help.metadata.property': 'Deck: {keys}. Collection: labels.',
  'help.metadata.value': 'Value(s) to set',
  'help.metadata.add': 'Add value(s) to an array property (tags, labels) instead of replacing it',
  'help.metadata.remove': 'Remove value(s) from an array property',

  // ── cleanup ───────────────────────────────────────────────────────────
  'help.cleanup.description':
    'Normalize every list file: canonical formatting, file names that match list names, and a format for every deck',
  'help.cleanup.dryRun': 'Report what would change without writing anything',
  'help.cleanup.skipFormats':
    'Never prompt for deck formats; leave formatless decks untouched and report them',
  'help.cleanup.check': 'Like --dry-run, but exit 1 when any file would change (for hooks and CI)',

  // ── get-primer ────────────────────────────────────────────────────────
  'help.getPrimer.description': 'Extract and output the primer for a deck as Markdown',
  'help.getPrimer.source':
    'Local deck name (e.g. winota-snowball-stax) or Moxfield URL to fetch from',
  'help.getPrimer.moxfieldUserAgent':
    'Moxfield-approved unique User-Agent string (required for Moxfield URL sources unless MOXFIELD_USER_AGENT is set)',
} as const satisfies MessageCatalogShape
