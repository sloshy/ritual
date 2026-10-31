/** Translator metadata for the `cli.*` namespace. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { cliMessages } from './cli'

/**
 * The interactive card session renders its menu inside a hard row budget
 * (`SESSION_MENU_LIMIT` in `src/commands/session/menu.ts`), so every `cli.menu.*`
 * entry carries a length
 * budget the catalog validator enforces. A menu row that wraps costs a second
 * terminal line, which pushes Save and Exit — the items at the menu's foot —
 * below the fold. German and Finnish labels run 30–50% longer than English, so
 * this is a real constraint rather than a theoretical one.
 *
 * Three tiers, sized against the English text they hold: a short verb phrase, a
 * full sentence-length row, and a row that also interpolates a card name (whose
 * own width is not the translator's to control, hence the tighter frame).
 */
const MENU_SHORT = 28
const MENU_MAX_LEN = 48
const MENU_WITH_NAME = 40

export const cliMeta = {
  'cli.addCard.matchCount': {
    description:
      'How many cards fuzzily match a name the user typed exactly. {shown} is the number as displayed and may be "100+" when the search stopped counting, so it is a separate parameter from the {count} that selects the plural form. The verb lives here rather than in cli.addCard.noExactMatch because it agrees with the count; the whole sentence reads "No exact match for \'X\'. 3 cards match that name."',
  },
  'cli.cleanup.unreadableFiles': {
    description:
      '`ritual cleanup` could not parse some list files and left them alone. Note the verb agreement between the forms.',
  },
  'cli.cleanup.decksNeedFormat': {
    description:
      '`ritual cleanup` found decks with no declared format and could not ask (no terminal). {flag} is the `--skip-formats` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.resolveAmbiguity.needsDecision': {
    description:
      'A collection sync cannot decide which list loses copies and has no terminal to ask in. {advice} is a pre-rendered sentence naming --removal-priority.',
  },
  'cli.resolveAmbiguity.confirm': {
    description:
      'Confirmation prompt offering to walk through ambiguous removals one at a time. Ends in a question mark.',
  },
  'cli.move.movedFewer': {
    description:
      'A move found fewer copies than asked for. {moved} is how many actually moved; {count} is how many were requested and selects the plural form.',
  },
  'cli.move.notEnoughCopies': {
    description:
      "A list holds fewer copies than the move asked for. {count} is what is available, {requested} what was asked for, {name} the card name and {list} the list's rendered name.",
  },
  'cli.scry.pageRange': {
    description:
      'Which pages of Scryfall results were fetched, spliced into a truncation notice. The singular form names page 1 alone; the plural is an inclusive range starting at 1.',
  },
  'cli.serve.priceSourcesUnderApi': {
    description:
      'Usage error: `serve --api --build --price-sources` was given, but the live server takes its stores from config. {priceSourcesFlag} is the `--price-sources` flag; {apiFlag} is the `--api` flag; {configKey} is the `priceSources` config key. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.serve.buildFlagsIgnored': {
    description:
      'Flags that only mean something with --build were passed to a plain `ritual serve`. {flags} is a comma-joined list of flag names, never translated; the verb agrees with how many were given. {flag} is the `--build` flag. It is typed or matched exactly by the user, so never translate it.',
  },

  'cli.skills.written': {
    description:
      'Summary line after writing agent skills to disk. {verb} names both the tense and the preposition English needs, because the two are coupled: "installedTo" is `ritual skills install`, "installedIn" the same write during `ritual init-site`, "updatedIn" a refresh. {counted} is a pre-rendered count and noun; {dir} is a filesystem path, never translated.',
  },
  'cli.skills.upToDate': {
    description:
      'Summary line for skills that already matched what Ritual would write. {counted} is a pre-rendered count and noun.',
  },
  'cli.skills.skipped': {
    description:
      'Summary line for skills left untouched because the user had edited them. {forceHint} is a pre-rendered sentence naming the flag that would overwrite them.',
  },
  'cli.skills.absent': {
    description:
      'Summary line for skills that are not installed at all. The trailing pronoun agrees with the count. {command} is the `ritual skills install` command line. It is typed or matched exactly by the user, so never translate it.',
  },

  'cli.sync.unreadableDecks': {
    description:
      'Heading above the list of unparseable lines found in decks about to sync. The verb agrees with the count.',
  },
  'cli.sync.unreadableCollectionLists': {
    description: 'The collection-list wording of the previous key.',
  },
  'cli.sync.confirmDecks': {
    description:
      'Confirmation prompt asking whether decks with unreadable lines may sync anyway. {cost} is a pre-rendered clause saying what accepting costs, e.g. "dropping those lines".',
  },
  'cli.sync.confirmCollectionLists': {
    description: 'The collection-list wording of the previous key.',
  },
  'cli.sync.refuseDecks': {
    description:
      'Refusal shown when decks with unreadable lines need confirmation but there is no terminal to ask in. {flag} is the `--yes` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.sync.refuseCollectionLists': {
    description:
      'The collection-list wording of the previous key. {flag} is the `--yes` flag. It is typed or matched exactly by the user, so never translate it.',
  },

  'cli.prompt.reason.noInput': {
    description:
      'Why prompting is impossible, shown in the parenthetical of "Input required: … (…)". This branch means the user asked for it. {flag} is the `--no-input` flag; {envVar} is the `RITUAL_NO_INPUT` environment variable. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.prompt.reason.noTty': {
    description:
      'The other branch of the previous key: stdin is not a terminal (a pipe, a CI job). The remedy is different, so the two must not be worded alike.',
  },
  'cli.prompt.subject.pass': {
    description:
      'Noun phrase for a refusal whose remedy is a flag or argument. {what} is that flag or argument spelled exactly as it is typed (e.g. "--from and --to") and is never translated. Reads as "Input required: pass --from and --to (…)".',
  },
  'cli.prompt.subject.passListName': {
    description:
      'Noun phrase for a --no-input refusal of the list picker: the run should have named the list as an argument. Reads as "Input required: pass a list name (…)".',
  },
  'cli.prompt.subject.passEither': {
    description:
      'Noun phrase for a --no-input refusal whose remedy is one of two flags (e.g. --skills or --no-skills). {first} and {second} are flags spelled exactly as typed and are never translated. Reads as "Input required: pass --skills or --no-skills (…)".',
  },
  'cli.prompt.subject.passBoth': {
    description:
      'Noun phrase for a --no-input refusal whose remedy is two flags given together (e.g. --from and --to). {first} and {second} are flags spelled exactly as typed and are never translated. Reads as "Input required: pass --from and --to (…)".',
  },
  'cli.prompt.subject.noInteractiveEditor': {
    description:
      'Why `ritual edit` refuses without a terminal. A noun phrase, not a sentence: it is spliced into "Input required: {subject} ({reason})." {addCardCommand} is the `add-card` command name; {removeCardCommand} is the `remove-card` command name; {setCardCommand} is the `set-card` command name; {noteCommand} is the `note` command name; {moveCommand} is the `move` command name. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.prompt.subject.noHistoryEditor': {
    description:
      'Why `ritual history` refuses without a terminal. A noun phrase spliced into "Input required: {subject} ({reason}).". {flag} is the `--show` flag. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.prompt.subject.passCardOrId': {
    description:
      'Noun phrase for a --no-input refusal of the card picker (several cards matched): the run should have named one card. {flag} is the flag spelled exactly as typed ("--card-id <id>") and is never translated. Reads as "Input required: pass a card name or --card-id <id> (…)".',
  },
  'cli.prompt.subject.interactiveInput': {
    description:
      'Fallback noun phrase for a prompt that has not yet been given a subject of its own. Deliberately vague — a converted prompt should name what it wanted instead.',
  },
  'cli.prompt.subject.deckSection': {
    description:
      'Noun phrase naming what the destination-section prompt wanted, spliced into the --no-input refusal frame.',
  },
  'cli.prompt.subject.moveDestination': {
    description:
      'Noun phrase naming what the move-destination prompt wanted, spliced into the --no-input refusal frame.',
  },
  'cli.prompt.subject.cardsToMove': {
    description:
      "Noun phrase naming what the move session's card search wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.subject.listType': {
    description:
      'Noun phrase for the import prompt asking whether the file is a deck, collection, or wanted list.',
  },
  'cli.prompt.subject.syncPrintings': {
    description:
      'Noun phrase for the URL-import prompt asking whether to keep the exact printings. {syncPrintingsFlag} is the `--sync-printings` flag; {noSyncPrintingsFlag} is the `--no-sync-printings` flag. Each is typed or matched exactly by the user, so never translate them.',
  },
  'cli.prompt.subject.filterValue': {
    description:
      'Noun phrase for the shared free-text filter prompt (the price browser and the export wizard).',
  },
  'cli.prompt.subject.exitChoice': {
    description:
      'Noun phrase for the unsaved-changes exit menu, which cannot be answered without a terminal.',
  },
  'cli.prompt.subject.artChoice': {
    description:
      "Noun phrase for the editor's Set Custom Art menu (enter a URL, pick a file, or clear).",
  },
  'cli.prompt.subject.artUrl': {
    description: 'Noun phrase for the prompt asking for a custom-art image URL.',
  },
  'cli.prompt.subject.artFile': {
    description: 'Noun phrase for the custom-art file browser over the configured art directory.',
  },
  'cli.prompt.subject.listImageMode': {
    description:
      "Noun phrase for set-list-image's menu asking which of the four cover-image modes to use.",
  },
  'cli.prompt.subject.listImageCard': {
    description: "Noun phrase for set-list-image's picker over the list's own cards.",
  },
  'cli.prompt.subject.sectionName': {
    description:
      'Noun phrase naming what the new-deck-section name prompt wanted, spliced into the --no-input refusal frame.',
  },
  'cli.prompt.subject.addSection': {
    description:
      "Noun phrase naming what the deck session's add-to-section prompt wanted, spliced into the --no-input refusal frame. Distinct from the move command's destination-section key.",
  },
  'cli.prompt.subject.targetSection': {
    description:
      "Noun phrase naming what the deck session's Set Target Section prompt wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.subject.moveSection': {
    description:
      "Noun phrase naming what the deck editor's Move to Section prompt wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.subject.setFilter': {
    description:
      'Noun phrase naming what the Configure Session Filters set-filter question wanted, spliced into the --no-input refusal frame.',
  },
  'cli.prompt.subject.editAction': {
    description:
      "Noun phrase naming what the editor's per-card action menu wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.subject.noteText': {
    description:
      'Noun phrase naming what a card note prompt wanted, spliced into the --no-input refusal frame.',
  },
  'cli.prompt.subject.categoriesText': {
    description:
      'Prompt subject named in the --no-input refusal for the Edit Categories text prompt.',
  },
  'cli.prompt.subject.categoryChoice': {
    description: 'Prompt subject named in the --no-input refusal for the Rename Category picker.',
  },
  'cli.prompt.subject.categoryName': {
    description:
      'Prompt subject named in the --no-input refusal for the Rename Category text prompt.',
  },
  'cli.prompt.subject.categoryOrderText': {
    description:
      'Prompt subject named in the --no-input refusal for the Reorder Categories prompt.',
  },
  'cli.prompt.subject.tagsText': {
    description:
      'Noun phrase naming what the card #tags prompt wanted, spliced into the --no-input refusal frame.',
  },
  'cli.prompt.subject.sessionChange': {
    description:
      'Noun phrase naming what the View Session Changes picker wanted, spliced into the --no-input refusal frame.',
  },
  'cli.prompt.subject.changeAction': {
    description:
      'Noun phrase naming what the per-change action menu wanted, spliced into the --no-input refusal frame.',
  },
  'cli.prompt.subject.sessionCard': {
    description:
      "Noun phrase naming what a card-entry session's main prompt wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.subject.listToEdit': {
    description:
      "Noun phrase naming what a card-entry session's main prompt wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.subject.newListName': {
    description:
      "Noun phrase naming what a card-entry session's main prompt wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.subject.addTarget': {
    description:
      "Noun phrase naming what a card-entry session's main prompt wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.subject.printing': {
    description:
      'Noun phrase naming what the printing picker wanted, spliced into the --no-input refusal frame.',
  },
  'cli.prompt.subject.languageFallback': {
    description:
      "Noun phrase naming what the printing picker's language-availability confirmation wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.subject.finish': {
    description:
      "Noun phrase naming what the editor's finish picker wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.subject.condition': {
    description:
      "Noun phrase naming what the editor's condition picker wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.subject.language': {
    description:
      "Noun phrase naming what the editor's card-language picker wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.subject.cardLabel': {
    description:
      "Noun phrase naming what the editor's per-card label picker wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.subject.defaultLabels': {
    description:
      "Noun phrase naming what the editor's list-default labels picker wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.subject.wantedFinish': {
    description:
      "Noun phrase naming what the wanted-list editor's finish picker wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.subject.specificity': {
    description:
      'Noun phrase naming what the wanted-list prompt asking for a specific printing or any printing wanted, spliced into the --no-input refusal frame.',
  },
  'cli.prompt.subject.deckTags': {
    description:
      "Noun phrase naming what the deck session's Edit Tags prompt wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.subject.removeConfirm': {
    description:
      "Noun phrase naming what the editor's remove-card confirmation wanted, spliced into the --no-input refusal frame.",
  },
  'cli.prompt.noMatches': {
    description:
      "Override for the `prompts` library's autocomplete empty state. Shown in place of a choice row, so keep it short and lowercase like the library's own default.",
  },
  'cli.prompt.toggleOn': {
    description: "Override for the `prompts` library's toggle 'on' label.",
  },
  'cli.prompt.toggleOff': {
    description: "Override for the `prompts` library's toggle 'off' label.",
  },
  'cli.prompt.selectHint': {
    description:
      'Grey hint after every select prompt\'s question, telling the user how to pick a row. {key} is the name of the submit key ("Return"), which stays English. The prompt shows a "- " before it.',
  },
  'cli.prompt.disabledChoice': {
    description:
      'Shown beside a select or multiselect prompt when the highlighted row cannot be chosen (a separator or an unavailable option). The prompt shows a "- " before it.',
  },
  'cli.prompt.invalidValue': {
    description:
      'Fallback error under a text prompt whose answer was rejected without a reason of its own. Almost every prompt supplies its own reason; this is the library default it replaces.',
  },
  'cli.prompt.confirmYes': {
    description:
      'A yes/no prompt\'s answer once the user said yes, printed after the question ("Save? … yes"). Keep it short and lowercase like the library default.',
  },
  'cli.prompt.confirmNo': {
    description: 'The same answer once the user said no ("Save? … no").',
  },
  'cli.prompt.confirmKeys': {
    description:
      'Shown after a yes/no question, naming the two keys that answer it. {yesKey} and {noKey} are the letters the prompt actually accepts ("y" and "n"), so they never translate; the default answer\'s letter arrives uppercase ("Y/n" or "y/N"). Only the punctuation and any words around them are yours.',
  },
  'cli.prompt.instructions.heading': {
    description:
      'Heading of the key list printed under a multiple-choice prompt (pick several rows). The key lines below it follow.',
  },
  'cli.prompt.instructions.highlight': {
    description:
      'Key line of the multiple-choice instructions. {keys} is the key names ("↑/↓"), which stay English: these keys move the highlight between rows.',
  },
  'cli.prompt.instructions.toggle': {
    description:
      'Key line of the multiple-choice instructions. {keys} is the key names ("←/→/[space]"), which stay English: these keys tick or untick the highlighted row.',
  },
  'cli.prompt.instructions.toggleAll': {
    description:
      'Key line of the multiple-choice instructions. {keys} is the key name ("a"), which stays English: it ticks or unticks every row at once.',
  },
  'cli.prompt.instructions.filter': {
    description:
      'Key line of a searchable multiple-choice prompt. {keys} is the key names ("[a,b,c]/delete"), which stay English: typing letters narrows the rows, delete widens them again.',
  },
  'cli.prompt.instructions.complete': {
    description:
      'Key line of the multiple-choice instructions. {keys} is the key names ("enter/return"), which stay English: they accept the ticked rows.',
  },
  'cli.card.text.nameWithCost': {
    description:
      'First line of a card (or of one face) in `ritual card`: the card name, then its mana cost in Scryfall symbols such as {R}{1}. Neither value is translated; only the spacing between them is.',
  },
  'cli.card.text.printing': {
    description:
      'Line of `ritual card`: which printing is shown. {printing} is the set code and collector number (e.g. "LEA:161"), {setName} the set\'s English name from Scryfall; neither is translated.',
  },
  'cli.card.text.price': {
    description:
      'Line of `ritual card`: the printing\'s price. {price} is the formatted price (or the "N/A" stand-in), {store} the store it comes from (e.g. "TCGplayer").',
  },
  'cli.scry.line': {
    description:
      'One search result of `ritual scry`, one per line: {name} the card name, {printing} the set code and collector number (e.g. "LEA:161"), {typeLine} the card type line from Scryfall, {price} the formatted price (or "N/A"). Only the separators are translated.',
  },

  'cli.menu.saveAndExit': {
    description: 'Unsaved-changes exit menu row: write pending changes to disk and leave.',
    maxLen: MENU_SHORT,
  },
  'cli.menu.exitWithoutSaving': {
    description: 'Unsaved-changes exit menu row: throw pending changes away and leave.',
    maxLen: MENU_SHORT,
  },
  'cli.menu.cancelKeepEditing': {
    description: 'Unsaved-changes exit menu row: dismiss the menu and stay in the editor.',
    maxLen: MENU_SHORT,
  },
  'cli.menu.exit': {
    description: 'Session menu row that leaves the editor. Sits at the foot of the menu.',
    maxLen: MENU_SHORT,
  },
  'cli.menu.back': {
    description: 'Row that returns to the previous screen without choosing anything.',
    maxLen: MENU_SHORT,
  },
  'cli.menu.cancel': {
    description: 'Row that abandons the current per-entry action menu.',
    maxLen: MENU_SHORT,
  },
  'cli.menu.switchList': {
    description:
      'Session menu row (unified editor only) that returns to the list selection menu, keeping unsaved changes in memory.',
    maxLen: MENU_SHORT,
  },
  'cli.menu.addExactCopy': {
    description:
      'Session menu row adding another copy of the last card, reusing its printing, finish and condition. {name} is the card name.',
    maxLen: MENU_WITH_NAME,
  },
  'cli.menu.addSimilarCopy': {
    description:
      'Session menu row adding a copy of the last card while re-asking for printing, finish and condition. {name} is the card name.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.menu.addNote': {
    description:
      'Session menu row attaching a note to the last added card. {name} is the card name.',
    maxLen: MENU_WITH_NAME,
  },
  'cli.menu.editPrevious': {
    description:
      'Session menu row re-opening the last added card to change its options in place rather than adding a copy. {name} is the card name.',
    maxLen: MENU_WITH_NAME,
  },
  'cli.menu.changeLastLanguage': {
    description:
      'Session menu row opening the language picker for the last added card, without re-asking its printing options. {name} is the card name.',
    maxLen: MENU_WITH_NAME,
  },
  'cli.menu.cardLanguage': {
    description:
      'Session menu row showing, and changing, the language stamped on cards added from here on. {language} is that language\u2019s name, already in the reader\u2019s language (e.g. "Japanese").',
    maxLen: MENU_WITH_NAME,
  },
  'cli.menu.undoLastAdd': {
    description: 'Session menu row taking back the most recent add. {name} is that card name.',
    maxLen: MENU_WITH_NAME,
  },
  'cli.menu.undoLastEdit': {
    description:
      'Session menu row reversing the most recent edit. {label} is a pre-rendered description of that edit, e.g. "printing on Sol Ring".',
    maxLen: MENU_WITH_NAME,
  },
  'cli.menu.configureFilters': {
    description:
      'Session menu row re-opening the session-wide filters (set codes, default finish and condition).',
    maxLen: MENU_MAX_LEN,
  },
  'cli.menu.collectorMode': {
    description:
      'Session menu row switching card entry from names to a set-code and collector-number search over every printing in the card cache.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.menu.nameMode': {
    description: 'Session menu row switching card entry back from collector numbers to names.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.menu.editMode': {
    description:
      'Session menu row switching from adding cards to editing the entries already in the list.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.menu.addMode': {
    description: 'Session menu row switching back from editing entries to adding cards.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.menu.viewChanges': {
    description:
      'Session menu row opening the list of changes made this session, any of which can be discarded. {count} is how many there are.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.menu.save': {
    description:
      'Session menu row writing pending changes to disk without leaving the session. {count} is how many are pending.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.menu.saveDirty': {
    description:
      'The previous row when the list differs from disk in a way that is not a counted card change (a deck format edit), so there is no number to show.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.menu.saveAll': {
    description:
      'Session menu row (unified editor) writing every open list. {scope} is a pre-rendered phrase describing how much is pending, from `cli.menu.saveAllScope` or a plain list count.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.menu.saveAllScope': {
    description:
      'The {scope} of the previous key when changes are spread over several lists. {count} is the total number of changes, {lists} a pre-rendered "N lists".',
    maxLen: MENU_MAX_LEN,
  },
  'cli.menu.saveCurrent': {
    description:
      "Session menu row (unified editor) writing only the list being edited, when another open list also has pending changes. {count} is this list's change count.",
    maxLen: MENU_MAX_LEN,
  },
  'cli.menu.saveCurrentPlain': {
    description: 'The previous row with no change count, for a list dirty in some uncounted way.',
    maxLen: MENU_MAX_LEN,
  },

  'cli.session.loadingCards': {
    description: 'Progress line before the card database is read for autocomplete.',
  },
  'cli.session.reloadingCards': {
    description: 'The previous line after the session filters changed.',
  },
  'cli.session.loadedCards': {
    description: 'How many cards the autocomplete was loaded with.',
  },
  'cli.session.cacheEmpty': {
    description:
      'Lead sentence of the refusal to start a session with no cached cards; advice on how to fill the cache is appended after it.',
  },
  'cli.session.preloadPrompt': {
    description:
      'Yes/no offer, made once when a card-entry session starts on an empty cache, to download the Scryfall card database. {scope} is one of the two cli.session.preloadScope* phrases naming what gets downloaded.',
  },
  'cli.session.preloadScopeEnglish': {
    description:
      'The {scope} of cli.session.preloadPrompt when only the English-language bulk is needed.',
  },
  'cli.session.preloadScopeAllLanguages': {
    description:
      'The {scope} of cli.session.preloadPrompt when the every-language bulk is needed. {language} is the configured defaultLanguage code; "all_cards" is a Scryfall bulk name — leave it untranslated. {configKey} is the `defaultLanguage` config key. It is typed or matched exactly by the user, so never translate it.',
  },
  'cli.session.preloadFailed': {
    description:
      'Error lead-in when the accepted preload download failed; the underlying error is printed after it and the session goes on with an empty cache. Keep the leading newline.',
  },
  'cli.session.createdFile': {
    description:
      'A list file did not exist and was created. {label} is the kind of list ("deck", "collection"), {file} the file name.',
  },
  'cli.session.usingFile': {
    description: 'The previous line when the file already existed.',
  },
  'cli.session.loadingPrintings': {
    description:
      "Progress line before collector number mode's printing pool is read out of the card cache.",
  },
  'cli.session.loadedPrintings': {
    description: 'How many printings that pool holds, once it has been read.',
  },
  'cli.session.filtersUpdated': {
    description: 'Confirmation that the session-wide filters were re-applied.',
  },
  'cli.session.changesSaved': { description: 'Confirmation that the list file was written.' },
  'cli.session.multiListSave': {
    description:
      'Internal error: something asked a multi-list editing session (`ritual edit` over several lists) to save as a whole, when each open list is saved on its own.',
  },
  'cli.session.artSidecarUnreadable': {
    description:
      "Warning after a session save that could not re-file a <list>.art.json custom-art sidecar — either the saved list's own (the ids its removals freed stay filed under the old numbers) or, when the save delivered cards moved to another list, that destination's (the moved cards' art did not follow them). Says \"A list's\" rather than \"The list's\" because it is not always the list being saved; {reason} is untranslated engine prose naming the file and the parse failure. Warns rather than fails: the card lines were written correctly.",
  },
  'cli.session.changelogSaved': {
    description: "Confirmation that the session's changelog block was appended.",
  },
  'cli.session.discardedAll': {
    description: 'Confirmation that the user chose to leave without saving.',
  },
  'cli.session.exitingEditor': { description: 'Farewell line from the unified multi-list editor.' },
  'cli.session.exitingManager': {
    description:
      'Farewell line from a single-list session. {manager} names the surface, e.g. "collection manager".',
  },
  'cli.session.returningToLists': {
    description: 'Shown when a unified-editor session backs out to the list selection menu.',
  },
  'cli.session.cardNotFound': {
    description: 'The autocomplete was submitted with nothing selected. Keep the leading icon.',
  },
  'cli.session.setFiltersActive': {
    description:
      'Follow-up to the previous line explaining that set filters may be hiding the card. {sets} is a comma-joined list of uppercase set codes and is never translated.',
  },
  'cli.session.addingSimilar': {
    description:
      'Announces re-entry of the last card with its option prompts forced. {name} is the card name.',
  },
  'cli.session.noteAdded': {
    description:
      'Confirmation that a note was attached. {name} is the card name, {note} the note text.',
  },
  'cli.session.switchedToEdit': {
    description: 'Confirmation of the switch to edit mode, with a hint at what to do next.',
  },
  'cli.session.switchedToAdd': { description: 'Confirmation of the switch back to add mode.' },
  'cli.session.switchedToCollector': {
    description:
      'Confirmation of the switch to collector-number entry, with a hint at what can be typed there.',
  },
  'cli.session.switchedToName': { description: 'Confirmation of the switch back to name entry.' },
  'cli.session.editingCard': {
    description: 'Announces that the last added card is being re-opened. {name} is the card name.',
  },
  'cli.session.noChanges': {
    description: 'The session-changes screen was opened with nothing to show.',
  },
  'cli.session.discardBlocked': {
    description:
      'A session change cannot be taken back yet because a later change depends on it. {reason} is a pre-rendered clause naming the blocker.',
  },
  'cli.session.collectorChoice': {
    description:
      'One row of the collector-number autocomplete. {printing} is a pre-rendered `SET:NUMBER` printing label (never translated — it is the grammar the user types to search), {name} the card name.',
  },
  'cli.session.forceOptions': {
    description:
      'Suffix marking an autocomplete row selected with a trailing "!", which forces the option prompts past the session defaults. {title} is the card name.',
  },
  'cli.session.streakHint': {
    description:
      'Parenthetical appended to the card prompt while the same card is being added repeatedly. {count} is how many in a row, {name} the card name. Keep the leading space: it is what separates this from the prompt text.',
  },
  'cli.row.quantity': {
    description:
      'A card row in an interactive picker (the price browser, the export wizard) led by its copy count, e.g. "2x Sol Ring (LEA:232) [foil] — $3.00". {count} is the number of copies (always more than one); {item} is the rest of the row, already rendered. The "x" is a multiplication marker.',
  },

  'cli.session.promptPickToEdit': {
    description:
      'Card prompt while the session is in edit mode, where the whole list is listed below the menu rows and can be scrolled or narrowed by typing.',
  },
  'cli.session.promptCardName': {
    description:
      'Card prompt while adding by name. {streak} is the possibly-empty `cli.session.streakHint`, which carries its own leading space.',
  },
  'cli.session.promptCollectorSearch': {
    description:
      'Card prompt while adding by set code and collector number. The MKM:123 example is the search grammar itself (a set code, a colon, a collector number) and must keep that shape; {streak} carries its own leading space.',
  },
  'cli.session.promptNote': { description: 'Prompt for a note on the card just added.' },
  'cli.session.promptNoteEdit': {
    description: "Prompt for an existing entry's note, where submitting nothing clears it.",
  },
  'cli.session.promptCategoriesEdit': {
    description:
      "Prompt for a card's categories in edit mode. The comma is the separator and never translates.",
  },
  'cli.session.promptCategoryRenameFrom': {
    description: 'Prompt selecting the category the edit-mode rename row will rename.',
  },
  'cli.session.promptCategoryRenameTo': {
    description: 'Prompt for the new name in the edit-mode rename row.',
  },
  'cli.session.promptCategoryOrder': {
    description: "Prompt for the list's category display order in edit mode.",
  },
  'cli.session.categoriesSidecarUnreadable': {
    description:
      'Warning when a session save (or a category action) cannot read <list>.categories.json; the card lines were written correctly.',
  },
  'cli.session.categoriesPruned': {
    description:
      'Save-time notice listing card names whose category entries were pruned because the list no longer holds them. Deliberately worded for the CLI (stderr, one line after a move or save) rather than shared with the site editors’ ui.editor.prunedCategories, which states the same fact as a sentence appended to a status toast; keep them separate rather than "fixing" one to match the other.',
  },
  'cli.session.promptTagsEdit': {
    description:
      "Prompt for an existing entry's #tags, prefilled with the current ones; the input is split on spaces and commas, and submitting nothing clears every tag.",
  },
  'cli.session.promptEditEntry': {
    description:
      'Heading of the per-entry action menu. {entry} is the rendered card line and is never translated.',
  },
  'cli.session.promptSetFilter': {
    description:
      'Session-filter prompt for the set codes autocomplete is restricted to. The example codes are real Magic sets and may stay as they are.',
  },
  'cli.session.promptDefaultFinish': {
    description: 'Session-filter prompt for the finish new cards get without being asked.',
  },
  'cli.session.promptDefaultCondition': {
    description: 'Session-filter prompt for the condition new cards get without being asked.',
  },
  'cli.session.promptPickChange': {
    description: 'Heading of the session-changes screen. {count} is how many changes it lists.',
  },
  'cli.session.promptChangeAction': {
    description:
      'Heading of the action menu for one session change. {label} is the rendered change line and is never translated.',
  },
  'cli.session.changeActionDetails': {
    description:
      "Session-changes action row opening the list type's own per-entry edit menu for the card this change touched.",
  },
  'cli.session.changeActionLanguage': {
    description:
      'Session-changes action row opening the language picker for the card this change touched.',
  },
  'cli.session.changeActionDiscard': {
    description: 'Session-changes action row taking the change back out of the session.',
  },
  'cli.session.cardLanguageSet': {
    description:
      'Confirmation after the Card Language menu action. {language} is the language\u2019s display name and {code} its Scryfall code, which never translates.',
  },
  'cli.session.finishAlwaysPrompt': {
    description:
      'Session-filter choice leaving the finish unset, so every add asks. Paired with the finish names below.',
  },
  'cli.session.conditionAlwaysPrompt': {
    description: 'Session-filter choice leaving the condition unset, so every add asks.',
  },
  'cli.session.conditionDontCare': {
    description:
      'Session-filter choice recording no condition at all on new cards — distinct from leaving it unset, which asks each time.',
  },

  'cli.exitMenu.promptCounted': {
    description:
      'Heading of the unsaved-changes exit menu when the editor knows how many changes are pending.',
  },
  'cli.exitMenu.prompt': {
    description: 'The previous heading when the editor only knows that something is unsaved.',
  },

  'cli.import.promptListType': {
    description: 'Prompt asking which kind of list an import should create or extend.',
  },
} as const satisfies MetaFor<typeof cliMessages>
