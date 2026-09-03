/** Translator metadata for {@link cliEditMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { cliEditMessages } from './cli-edit'

/**
 * The interactive session menu renders inside a hard row budget
 * (`SESSION_MENU_LIMIT` in `src/commands/session/menu.ts`), and the per-strategy
 * rows below sit in the same
 * list as the shared `cli.menu.*` items — so they carry the same length budget
 * (`MENU_MAX_LEN` in `cli.meta.ts`). A row that wraps costs a second terminal
 * line and pushes Save and Exit below the fold.
 */
const MENU_MAX_LEN = 48

export const cliEditMeta = {
  'cli.manager.deck': {
    description:
      'Names the deck editing session in its farewell line, "Exiting {manager}." — a noun phrase, lower case, not a sentence.',
  },
  'cli.manager.collection': {
    description:
      'Names the collection editing session in "Exiting {manager}." — a lower-case noun phrase.',
  },
  'cli.manager.wanted': {
    description:
      'Names the wanted-list editing session in "Exiting {manager}." — a lower-case noun phrase.',
  },
  'cli.manager.editor': {
    description:
      'Names a multi-list session (All Lists, All Decks, …) in "Exiting {manager}." — a lower-case noun phrase.',
  },

  'cli.edit.current': {
    description:
      "Marks the picker row holding the value already in force. {label} is the row's own text, which may itself be a translated label or a card/format name.",
  },
  'cli.edit.new': {
    description:
      "Marks a list that exists only in this session and has no file yet. {label} is the list's icon and name.",
  },

  'cli.edit.listNoun': {
    description:
      'The bare, lower-case noun for a list type, spliced into "Created new {label} file: …". Not a sentence and not capitalised — the frame supplies both.',
  },

  'cli.edit.promptSelectList': {
    description: "Prompt heading for the unified editor's list picker. No trailing colon.",
  },
  'cli.edit.promptNewListName': {
    description:
      "Prompt asking for a new list's name, one branch per list type. Ends in a colon like the other text prompts.",
  },
  'cli.edit.nameEmpty': {
    description: 'Validation message shown under the new-list name prompt when nothing was typed.',
  },
  'cli.edit.badgeNew': {
    description:
      'Badge on a list created this session and not yet written. Joined with the unsaved-changes badge by ", " and appended to the row as " — new, 2 unsaved change(s)". Lower case, very short.',
    maxLen: 12,
  },
  'cli.edit.badgeUnsaved': {
    description:
      'Badge counting a list\'s pending changes in the selection menu. The English "(s)" is a legacy contraction rather than a real plural; a translator should write whatever their language does for an unknown count.',
    maxLen: 28,
  },
  'cli.edit.listFileExists': {
    description:
      'Refusal when the list the user is creating would land on a file already open in the editor. {file} is a filesystem path, never translated.',
  },
  'cli.edit.pendingCollision': {
    description:
      'Refusal when a list created earlier in this session folds onto the name being created now. {name} is the existing list, {query} the name just typed. "list-name folding" is Ritual\'s term for case/punctuation-insensitive name matching.',
  },
  'cli.edit.createdList': {
    description:
      'Confirmation that a list now exists in memory. The parenthetical is the important half: nothing is on disk until the editor is saved.',
  },
  'cli.edit.creatingList': {
    description:
      'Progress line while the editor writes a list that had no file yet. Paired with cli.edit.savingList, which is the same action on an existing list.',
  },
  'cli.edit.savingList': {
    description: 'Progress line while the editor writes an existing list back to disk.',
  },
  'cli.edit.openingLists': {
    description:
      'Progress line before a multi-list scope loads every list it spans. The singular form is unreachable today (a scope needs at least two lists) but is written out so the message stays honest.',
  },
  'cli.edit.noInteractiveEditor': {
    description:
      'Why `ritual edit` refuses without a terminal. A noun phrase, not a sentence: it is spliced into "Input required: {subject} ({reason})." The command names are CLI identifiers and never translate.',
  },
  'cli.edit.creationChange': {
    description:
      'The View Session Changes row standing for "this list was created this session". Discarding it drops the whole list.',
  },
  'cli.edit.discardCardChangesFirst': {
    description:
      'Why the creation row above cannot be discarded yet. A lower-case imperative clause: it is spliced into "Cannot discard \\"…\\" yet — {reason}." The English "(s)" is a legacy contraction, not a real plural.',
  },
  'cli.edit.discardedList': {
    description: 'Confirmation that a list created this session was taken back out of the editor.',
  },

  'cli.scope.allLists': {
    description:
      'Menu row opening one session over every list of every type. Rendered after a 🗃️ icon.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.scope.allOfType': {
    description:
      "Menu row opening one session over every list of a single type. Rendered after that type's icon.",
    maxLen: MENU_MAX_LEN,
  },
  'cli.edit.promptAddTarget': {
    description:
      'Prompt asking which list a card should be added to, in a session spanning several lists.',
  },
  'cli.edit.noListSelected': {
    description: 'Printed when the add-target prompt was cancelled, so the card was not added.',
  },

  'cli.edit.sessionAdd': {
    description:
      'A View Session Changes row for a card added this session. {label} is the rendered card line. Rendered after a ➕ icon.',
  },
  'cli.edit.undoBlockedGone': {
    description:
      'Why a change cannot be discarded: it is no longer in the stack. A lower-case clause spliced into "Cannot discard \\"…\\" yet — {reason}."',
  },
  'cli.edit.undoBlockedNewer': {
    description:
      "Why a change cannot be discarded out of order: a newer change touches the same card. A lower-case imperative clause; {label} is that newer change's own description.",
  },
  'cli.edit.cannotDiscardYet': {
    description:
      'The frame the two reasons above sit in. {label} is the change being refused, {reason} the lower-case clause explaining why.',
  },
  'cli.edit.undid': {
    description:
      'Confirmation that an edit-mode operation was reverted. {label} is one of the cli.editLabel.* phrases.',
  },
  'cli.edit.undoHistoryCleared': {
    description:
      'Notice that discarding a session add renumbered card ids, so the edit-undo stack could no longer be replayed and was dropped. Parenthesised because it is a side effect of what the user just asked for.',
  },

  'cli.editLabel.printing': {
    description:
      'Names a printing change for the undo menu. Reads as the object of "Undo …" / "Discard …", so it is a noun phrase, not a sentence.',
  },
  'cli.editLabel.finish': {
    description: 'Names a finish change for the undo menu. A noun phrase, like the others here.',
  },
  'cli.editLabel.condition': { description: 'Names a condition change for the undo menu.' },
  'cli.editLabel.language': {
    description:
      "Names a card-language change for the undo menu — the printing's language, never the UI locale.",
  },
  'cli.editLabel.labels': {
    description: 'Names a card-label change (for sale / for trade / to keep) for the undo menu.',
  },
  'cli.editLabel.categories': {
    description: 'Undo-menu label for an Edit Categories action.',
  },
  'cli.editLabel.tags': {
    description:
      "Names a card-tag edit (the owner's free-form tags on one card) for the undo menu. One entry covers every tag the edit changed.",
  },
  'cli.editLabel.note': { description: 'Names a note edit for the undo menu.' },
  'cli.editLabel.section': {
    description: 'Names a deck-section move for the undo menu ("of", not "on", in English).',
  },
  'cli.editLabel.removeCopy': {
    description:
      'Names the removal of one copy from a multi-copy line, for the undo menu. A gerund phrase in English so it reads under "Undo …".',
  },
  'cli.editLabel.removal': {
    description: 'Names the removal of a whole line, for the undo menu.',
  },
  'cli.editLabel.art': {
    description:
      "Names a custom-art edit for the undo menu, as the object of 'Undo …'. Reads like the sibling labels above it.",
  },
  'cli.editLabel.moveToList': {
    description:
      'Names a cross-list move for the undo menu. {list} is the destination list rendered as icon + name.',
  },

  'cli.editAction.changePrinting': {
    description: 'Edit-mode menu row: pick a different printing for this card.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.editAction.setPrinting': {
    description:
      'Edit-mode menu row shown instead of the "change printing" row when the line pins no printing yet: pick the printing for this card for the first time.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.editAction.changeFinish': {
    description: 'Edit-mode menu row: pick a different finish (nonfoil / foil / etched).',
    maxLen: MENU_MAX_LEN,
  },
  'cli.editAction.changeCondition': {
    description: 'Edit-mode menu row: pick a different condition (NM, LP, …).',
    maxLen: MENU_MAX_LEN,
  },
  'cli.editAction.changeLanguage': {
    description: 'Edit-mode menu row: pick a different card language for this printing.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.editAction.changeLabel': {
    description: "Edit-mode menu row: set or clear this card's label override.",
    maxLen: MENU_MAX_LEN,
  },
  'cli.editAction.editCategories': {
    description: "Edit-mode per-card action that sets the card's categories in this list.",
  },
  'cli.editAction.editTags': {
    description:
      "Edit-mode menu row: edit this card's free-form tags (the owner's own vocabulary, as many per card as they like). Distinct from labels, which are a fixed vocabulary.",
    maxLen: MENU_MAX_LEN,
  },
  'cli.editAction.setArt': {
    description:
      "Edit-mode menu row: set or clear this card's custom art — the image shown in place of the printing's own scan.",
    maxLen: MENU_MAX_LEN,
  },
  'cli.editAction.moveToSection': {
    description: 'Edit-mode menu row: move this deck card to another section.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.editAction.moveToList': {
    description: 'Edit-mode menu row: move this card to another list (deck, collection, wanted).',
    maxLen: MENU_MAX_LEN,
  },
  'cli.editAction.editNote': {
    description: 'Edit-mode menu row: edit the note attached to this card.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.editAction.addCopy': {
    description: 'Edit-mode menu row: add one more copy of this deck line.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.editAction.removeCopy': {
    description: 'Edit-mode menu row: remove one copy from a deck line holding several.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.editAction.removeAllCopies': {
    description:
      'Edit-mode menu row: remove every copy of a deck line. {count} is how many copies would go.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.editAction.removeCard': {
    description: 'Edit-mode menu row: remove a deck line that holds a single copy.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.editAction.remove': {
    description:
      'Edit-mode menu row: remove this collection or wanted-list entry (each line is one card, so there is no copy count).',
    maxLen: MENU_MAX_LEN,
  },

  'cli.edit.confirmRemove': {
    description:
      'Yes/no confirmation before removing an entry. {line} is the rendered card line, which is file-format text and never translated.',
  },
  'cli.edit.changedLine': {
    description: 'Echoes an entry back after a field edit. {line} is the rendered card line.',
  },
  'cli.edit.addedLine': { description: 'Echoes a freshly added entry as its canonical card line.' },
  'cli.edit.addedLineTotal': {
    description:
      'Echoes an added copy together with the running total for this card. The "x" in "{count}x total" is a multiplication marker, not a letter.',
  },
  'cli.edit.editedLine': {
    description: 'Echoes the just-added entry after the user re-edited it before moving on.',
  },
  'cli.edit.removedLine': { description: 'Echoes an entry that was just removed.' },
  'cli.edit.discardedCard': {
    description:
      'Confirms that a card added this session was discarded. {name} is the card name, never translated.',
  },
  'cli.edit.removedPlaceholder': {
    description:
      'Stands in for a session add whose entry is already gone, in the discard picker. "&{id}" is Ritual\'s internal card-line id syntax and must stay exactly as written.',
  },
  'cli.edit.noteSet': { description: 'Confirms a note was written onto a card.' },
  'cli.edit.noteCleared': { description: "Confirms a card's note was emptied." },
  'cli.edit.tagsSet': {
    description:
      "Confirms a card's tags after an edit. {tags} is the comma-joined new set (`Card Draw, Ramp`) — a data token, never translated.",
  },
  'cli.edit.tagsCleared': { description: 'Confirms every tag was taken off a card.' },
  'cli.edit.categoriesSet': {
    description:
      'Confirmation after an Edit Categories action, listing the new categories primary first.',
  },
  'cli.edit.categoriesCleared': {
    description: 'Confirmation after an Edit Categories action that emptied the field.',
  },
  'cli.edit.categoriesInvalid': {
    description:
      'Reported when a typed category list is refused; the prompt re-offers what was typed.',
  },
  'cli.edit.categoriesVocabulary': {
    description:
      "Hint printed above the Edit Categories prompt: the list's own vocabulary followed by the configured defaults.",
  },
  'cli.edit.categoriesNone': {
    description:
      'Reported when a list-level category menu row is chosen for a list with an empty vocabulary.',
  },
  'cli.edit.categoryOrderEmpty': {
    description:
      'Refusal when the edit-mode Reorder Categories prompt is answered with nothing. Clearing the order is not what reordering means, so the prompt asks again.',
  },
  'cli.edit.categoriesRenamed': {
    description: 'Confirmation after the edit-mode Rename Category row.',
  },
  'cli.edit.categoriesReordered': {
    description: 'Confirmation after the edit-mode Reorder Categories row.',
  },
  'cli.edit.tagsInvalid': {
    description:
      'Shown when the typed tags are refused, before the prompt is offered again. {reason} is the English data-format rule the tag parser states (which punctuation a tag cannot contain).',
  },
  'cli.edit.noConfiguredLanguage': {
    description:
      'Startup warning when ritual.config.json declares no defaultLanguage, so new cards are stamped English. {language} is the `en` code; `defaultLanguage`, `ritual config set` and the code itself are literals that never translate.',
  },
  'cli.edit.noPrintings': {
    description:
      "The card has no printings left after the session's set filters and digital-only exclusion, so there is nothing to pick.",
  },
  'cli.edit.noPrintingsNameOnly': {
    description:
      'Same as above, for the two list types whose format allows an entry with no printing at all — the card is still added, by name.',
  },
  'cli.edit.fileWarning': {
    description:
      'Frames a parser warning with the file it came from. {file} is a base file name and {warning} an already-rendered sentence; both arrive untranslated.',
  },

  'cli.edit.discardInboundMovesFirst': {
    description:
      "Why a session-created list's creation cannot be discarded yet: other open lists hold pending moves into it, which would lose their destination. Spliced as the reason into cli.edit.cannotDiscardYet-style rows.",
  },
  'cli.edit.promptMoveTarget': {
    description: 'Prompt heading for the destination picker of a cross-list card move.',
  },
  'cli.edit.noMoveTargets': {
    description:
      'The Move to Another List action found nothing to offer: the list being edited is the only one.',
  },
  'cli.edit.moveNeedsPrinting': {
    description:
      'A name-only card cannot enter a collection (every collection line pins a printing) and the printing picker found none to pin, so the move is abandoned.',
  },
  'cli.edit.movedToList': {
    description:
      'Confirms a card was moved out of the edited list. {line} is an already-rendered canonical card line and {list} the destination rendered as icon + name; the parenthetical reminds that the destination receives the card when the list is saved.',
  },
  'cli.edit.moveNoteDropped': {
    description:
      'Warns, at move time, that the note attached to the moving card stays behind — the destination line arrives without it.',
  },
  'cli.edit.savingMoveDest': {
    description:
      'Progress line while a save also writes an open destination list that just received moved cards.',
  },
  'cli.edit.moveCommitFailed': {
    description:
      'A save could not validate the destination side of a pending cross-list move (e.g. the destination file was deleted, or a printing-less card was headed into a collection). {name} is the list whose save was requested; {error} is an already-rendered message spliced after the colon. The save is aborted before any file is written, so nothing is lost.',
  },
  'cli.edit.moveWriteFailed': {
    description:
      'An I/O error interrupted the write phase of a save that delivers cross-list moves: unlike moveCommitFailed, some destination files may already have been written when it struck. {name} is the list whose save was requested (left unsaved); {error} is an already-rendered message spliced after the colon.',
  },

  'cli.deck.promptFormat': { description: 'Prompt heading for the deck-format picker.' },
  'cli.deck.formatNotSet': {
    description:
      "Stands in for a deck format in the menu row when the deck declares none. Lower case: it sits inside parentheses after the row's label.",
  },
  'cli.deck.formatChanged': {
    description: 'Confirms a new deck format. {format} is a format name from the domain catalog.',
  },
  'cli.deck.tagsNone': {
    description:
      "Stands in for a deck's tags in the menu row when it has none. Lower case, inside parentheses.",
  },
  'cli.deck.promptTags': {
    description:
      "Prompt for the deck's tags. The separator is a literal comma and stays a comma whatever the locale, because the value is parsed back.",
  },
  'cli.deck.tagsSet': {
    description: "Confirms the deck's new tags. {tags} is the comma-joined list the user typed.",
  },
  'cli.deck.tagsCleared': { description: 'Confirms every tag was removed from the deck.' },
  'cli.deck.menuTargetSection': {
    description:
      'Session menu row showing (and changing) the deck section new cards go into. {section} is a section name or the "prompt every time" phrase.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.deck.menuChangeFormat': {
    description: "Session menu row showing (and changing) the deck's format.",
    maxLen: MENU_MAX_LEN,
  },
  'cli.deck.menuEditTags': {
    description:
      "Session menu row showing (and editing) the deck's front-matter tags — the deck's own, not any card's; the per-card row is cli.editAction.editTags.",
    maxLen: MENU_MAX_LEN,
  },
  'cli.deck.promptEveryTime': {
    description:
      'Picker row choosing to be asked for a section on every card rather than pinning one. Title case, because it is a row of its own.',
  },
  'cli.deck.promptEveryTimeInline': {
    description:
      'The same choice, worded for the middle of a sentence ("Target section: prompt every time.") and inside the menu row\'s parentheses. Lower case.',
  },
  'cli.deck.newSection': {
    description: 'Picker row creating a section that does not exist yet. Rendered after a "+ ".',
  },
  'cli.deck.newSectionMore': {
    description:
      'The same row in the session-config form, where the trailing ellipsis signals that another prompt follows.',
  },
  'cli.deck.promptNewSectionName': { description: "Prompt for a new deck section's name." },
  'cli.deck.sectionNameEmpty': {
    description: 'Validation message under the new-section prompt when nothing was typed.',
  },
  'cli.deck.promptAddSection': {
    description: 'Prompt asking which section a card being added should go into.',
  },
  'cli.deck.promptMoveSection': {
    description: 'Prompt asking which section an existing card should move to.',
  },
  'cli.deck.promptTargetSection': {
    description: 'Prompt heading for pinning the section that new cards default into.',
  },
  'cli.deck.targetSectionSet': {
    description:
      'Confirms the pinned section. {section} is a section name or cli.deck.promptEveryTimeInline.',
  },
  'cli.deck.filtersUpdatedSection': {
    description:
      'The deck session\'s version of "Session filters updated.", which also reports the pinned section.',
  },
  'cli.deck.addedCard': {
    description:
      'Confirms a card was added to a deck section. {card} is the card name plus its printing and language annotation, already rendered; {section} is a section name.',
  },
  'cli.deck.addedAnother': {
    description:
      'Confirms another copy joined an existing deck line. {count} is the line\'s new total; the "x" is a multiplication marker.',
  },
  'cli.deck.removedFromSection': {
    description: 'Confirms every copy of a card was removed from a deck section.',
  },
  'cli.deck.noSectionSelected': {
    description: 'Printed when the section prompt was cancelled, so the card was not added.',
  },
  'cli.deck.editedPrinting': {
    description:
      'Confirms the just-added deck card was re-pointed at another printing. {printing} is a SET:number pair and never translates; the arrow is layout.',
  },

  'cli.labels.promptOverride': {
    description: "Prompt heading for a single card's label override.",
  },
  'cli.labels.promptDefault': {
    description: "Prompt heading for the whole list's default labels.",
  },
  'cli.labels.menuListLabels': {
    description:
      "Session menu row showing (and editing) the list's default labels (decks and collections). {labels} is a comma-joined list of label tokens, which are file-format vocabulary and never translate.",
    maxLen: MENU_MAX_LEN,
  },
  'cli.labels.none': {
    description:
      'Stands in for the default labels in the menu row when the list sets none. Lower case, inside parentheses.',
  },
  'cli.labels.defaultSet': {
    description:
      "Confirms the list's new default labels. The square brackets mirror how the value is written in the file.",
  },
  'cli.labels.defaultCleared': {
    description: 'Confirms the list no longer sets a default label.',
  },
  'cli.art.promptAction': {
    description:
      "Prompt heading for the Set Custom Art action. {art} is the card's current reference — an art-directory-relative file path or a URL, never translated — or the 'none set' string below.",
  },
  'cli.art.none': {
    description: 'Stands in for {art} above when the card has no custom art yet.',
  },
  'cli.art.actionUrl': {
    description: 'Set Custom Art menu row: type an image URL.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.art.actionFile': {
    description: 'Set Custom Art menu row: browse the configured art directory for an image file.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.art.actionClear': {
    description:
      "Set Custom Art menu row: drop the card's custom art so its real printing scan shows again. Offered only when it has some.",
    maxLen: MENU_MAX_LEN,
  },
  'cli.art.promptUrl': { description: 'Prompt heading for typing an image URL.' },
  'cli.art.promptPickFile': {
    description:
      'Prompt heading for the art-directory file browser. {dir} is the directory being listed, as a path.',
  },
  'cli.art.rowUp': {
    description:
      "File-browser row that leaves the current directory for the one above it. The leading '..' is the path convention and stays as it is.",
    maxLen: MENU_MAX_LEN,
  },
  'cli.art.dirMissing': {
    description:
      "Refusal when the configured art directory does not exist. {dir} is its path; the 'ritual config set artDir' command never translates.",
  },
  'cli.art.dirGone': {
    description:
      'Refusal when a directory *inside* the art tree — one the file browser had just listed — is no longer there. {dir} is that directory’s path, not the art directory’s.',
  },
  'cli.art.dirUnreadable': {
    description:
      'Refusal when a directory in the art tree could not be listed. {reason} is the operating system error text.',
  },
  'cli.art.dirEmpty': {
    description:
      'Notice that a directory holds no image Ritual can use. {extensions} is the comma-separated list of accepted file extensions and never translates.',
  },
  'cli.art.invalid': {
    description:
      'Reports that the reference the user gave was refused, so nothing changed. {reason} is untranslated engine prose from the art parser (e.g. \'"x" is not a valid URL\').',
  },
  'cli.art.sidecarUnreadable': {
    description:
      "Refusal to open the art action when the list's <list>.art.json sidecar cannot be read, since saving would overwrite it. {reason} is untranslated engine prose naming the file.",
  },
  'cli.art.set': {
    description:
      "Confirms the card's new custom art, staged like every other session edit. {art} is the file path or URL.",
  },
  'cli.art.cleared': {
    description: "Confirms the card's custom art was dropped, staged until the session is saved.",
  },
  'cli.collection.frontMatterUnreadable': {
    description:
      "Refusal to edit default labels when the file's YAML front matter cannot be parsed, because rewriting it would destroy keys Ritual cannot see.",
  },
  'cli.collection.noPrintingsSkip': {
    description:
      'A collection entry requires a printing, so a card with none is skipped rather than added by name.',
  },

  'cli.wanted.promptSpecificity': {
    description:
      'Prompt asking whether a wanted entry should name a printing or just the card. {name} is the card name.',
  },
  'cli.wanted.specificityNameOnly': {
    description:
      'The row choosing an entry with no printing; the parenthetical explains that pricing then follows whichever printing is cheapest.',
  },
  'cli.wanted.specificitySpecific': {
    description: 'The row choosing an entry pinned to one printing.',
  },
  'cli.wanted.noPreference': {
    description:
      'Finish-picker row leaving the finish unset. Wrapped by cli.edit.current when it is what the entry already says.',
  },
  'cli.wanted.noPreferenceAny': {
    description:
      'The same row when it is not the current value; the parenthetical spells out what leaving it unset means.',
  },

  'cli.printing.promptSelect': { description: 'Prompt heading for the printing picker.' },
  'cli.printing.promptFinish': {
    description: 'Prompt heading for the finish picker while adding a card.',
  },
  'cli.printing.promptFinishShort': {
    description:
      'Prompt heading for the finish picker while editing an existing entry, where the surrounding context already says what is being changed.',
  },
  'cli.printing.promptCondition': { description: 'Prompt heading for the condition picker.' },
  'cli.printing.promptLanguage': {
    description:
      'Prompt heading for the card-language picker — the language of the printing, never the UI locale.',
  },
  'cli.printing.row': {
    description:
      'One printing in the picker. Every parameter is data: {setName} the set\'s name, {set} its uppercase code, {number} the collector number, {rarity} the Scryfall rarity slug. The "#" and brackets are Ritual\'s notation.',
  },
  'cli.printing.languageBadge': {
    description:
      'Appended to a printing row that does not exist in the configured card language. {languages} is a comma-joined list of Scryfall language codes.',
  },
  'cli.printing.languageRow': {
    description:
      "One card language in the language picker. {name} is the language's name, {code} its Scryfall code (never translated).",
  },
  'cli.printing.languageUnavailable': {
    description:
      "Explains that the picked printing was never made in the configured card language. {printing} is a SET:number pair, {language} the configured language's name, {available} the languages it does exist in.",
  },
  'cli.printing.useLanguage': {
    description:
      'The row accepting a printing in a language other than the configured one. {code} is the Scryfall language code.',
  },
  'cli.printing.pickAnother': {
    description: 'The row going back to the printing picker instead. Rendered after a "← ".',
  },
  'cli.printing.noSetFilterMatch': {
    description:
      "Warning that the session's set filter matched none of this card's printings, so the filter was ignored for this card. {sets} is a comma-joined list of set codes.",
  },
  'cli.printing.noneCached': {
    description:
      'A strict --set/--collector-number pin could not be checked because the card has no printings in the local Scryfall cache at all.',
  },
  'cli.printing.pinNotFound': {
    description:
      'A strict printing pin named a printing that does not exist. {listed} is a comma-joined list of SET:number pairs and {more} is either empty or cli.printing.andMore.',
  },
  'cli.printing.andMore': {
    description:
      'Tail appended to a truncated list of printings. Begins with the separator so it joins the list cleanly.',
  },
  'cli.printing.finishUnavailable': {
    description:
      'A --finish pin named a finish this printing is not offered in. {finish} and {available} are finish slugs (nonfoil / foil / etched), which are file-format vocabulary and never translate.',
  },

  'cli.history.limitInvalid': {
    description:
      'Usage error from `ritual history --limit`. The flag name never translates. Exits 2.',
  },
  'cli.history.limitRequiresShow': {
    description: 'Usage error: --limit only means something together with --show.',
  },
  'cli.history.outputRequiresShow': {
    description:
      'Usage error: structured output is only produced by the read-only --show fork. {output} is the format the user asked for (json or ndjson).',
  },
  'cli.history.noEditorHeadless': {
    description:
      'Why `ritual history` refuses without a terminal. A noun phrase spliced into "Input required: {subject} ({reason})."; --show is a flag name and never translates.',
  },
  'cli.history.noHistory': {
    description: 'Printed by `history --show` when the list has never recorded a change.',
  },
  'cli.history.setCount': {
    description:
      'How many change sets a changelog holds, as a counted noun spliced into cli.history.heading. A "change set" is one dated group of entries in a list\'s `.changes.md` sidecar.',
  },
  'cli.history.heading': {
    description:
      'Opening line of a change history. {name} is the list\'s name and {sets} an already-rendered count from cli.history.setCount ("2 change sets"), which is separate so the noun can inflect without duplicating the sentence across the three list types.',
  },
  'cli.history.setHeading': {
    description:
      'One change set\'s header: {timestamp} is an ISO-8601 instant (never translated, never reformatted) and {changes} an already-rendered count like "3 changes". The two spaces are column alignment.',
  },
  'cli.history.noListsOfType': {
    description:
      'Nothing to show a history for, when a type flag narrowed the search. English says "wanted list lists" for the third branch; keep whatever reads naturally rather than copying that.',
  },
  'cli.history.promptSelectList': {
    description: "Prompt heading for the history command's list picker.",
  },
  'cli.history.listRow': {
    description:
      'One list in that picker: its name, then its type. {type} is a singular list-type name from the domain catalog.',
  },
  'cli.history.promptMain': { description: "Prompt heading for the history editor's main menu." },
  'cli.history.undoLast': {
    description:
      'Menu row reverting the last history edit. {count} is how many undo steps remain. Rendered after a ↩️ icon.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.history.preview': {
    description: 'Menu row showing what saving would write, without writing it. After a 🔍 icon.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.history.rewrite': {
    description:
      'Menu row replacing the whole history with one generated change set. Destructive; after a 🔄 icon.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.history.promptSetAction': {
    description: 'Prompt heading for the actions available on one change set.',
  },
  'cli.history.deleteSet': {
    description: 'Menu row deleting one change set. After a ➖ icon.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.history.combineSet': {
    description: 'Menu row folding one change set into another. After a 🔗 icon.',
    maxLen: MENU_MAX_LEN,
  },
  'cli.history.editTimestamp': {
    description: "Menu row changing a change set's timestamp. After a ✏️ icon.",
    maxLen: MENU_MAX_LEN,
  },
  'cli.history.setDeleted': {
    description:
      'Confirms a change set was deleted. The parenthetical matters: nothing is written until the editor is saved.',
  },
  'cli.history.noOtherSet': {
    description: 'Refusal to combine when the history holds only the one change set.',
  },
  'cli.history.promptCombine': {
    description:
      'Prompt heading for picking the change set to fold in. The second sentence spells out that the picked set is consumed.',
  },
  'cli.history.setsCombined': {
    description: 'Confirms two change sets were merged, in memory only.',
  },
  'cli.history.promptTimestamp': {
    description:
      'Prompt for a change set\'s new timestamp. "ISO-8601" is a standard\'s name and stays as written.',
  },
  'cli.history.timestampInvalid': {
    description:
      'Validation message under that prompt. The example is a literal instant and must stay exactly as written.',
  },
  'cli.history.timestampUpdated': { description: 'Confirms a retimed change set, in memory only.' },
  'cli.history.proseWarning': {
    description:
      'Warns that a rewrite would throw away hand-written prose kept alongside the change sets. Spliced into cli.history.confirmRewrite after a space. The English "(s)" is a legacy contraction.',
  },
  'cli.history.confirmRewrite': {
    description:
      'Confirmation before replacing the entire history. {warning} is either empty or cli.history.proseWarning, already space-prefixed. "ALL" is capitalised to mark how destructive this is.',
  },
  'cli.history.rewriteYes': {
    description: 'The row accepting the rewrite. Rendered after a ✅ icon.',
  },
  'cli.history.rewriteNo': {
    description: 'The row declining it. Rendered after a "← ".',
  },
  'cli.history.emptyList': {
    description: 'The rewrite found no cards to describe, so there is nothing to write.',
  },
  'cli.history.categoriesUnreadable': {
    description:
      "Warning printed before a history rewrite: the list's <list>.categories.json sidecar could not be read, so the rebuilt history will describe no categories. {reason} is the parser's English sentence, already naming the file.",
  },
  'cli.history.rewrote': {
    description:
      'Confirms the generated change set, in memory only. The English "entr(y/ies)" is a legacy contraction rather than a real plural.',
  },
  'cli.history.nothingToUndo': { description: "The history editor's undo stack is empty." },
  'cli.history.reverted': { description: 'Confirms one history edit was undone.' },
  'cli.history.previewHeading': {
    description: 'Heading above the save preview. The rules are box drawing, not letters.',
  },
  'cli.history.previewSets': {
    description:
      'How many change sets the save would go from and to. The arrow is layout and stays as written.',
  },
  'cli.history.previewLines': { description: 'The same, counting individual change lines.' },
  'cli.history.noPending': {
    description: 'The preview found the file would be written exactly as it already reads.',
  },
  'cli.history.resultingSets': {
    description: 'Heading above the list of change sets that survive.',
  },
  'cli.history.noneEmptied': {
    description:
      'Stands in for that list when every change set was deleted — saving would leave an empty changelog. Printed indented.',
  },
  'cli.history.promptDonePreview': {
    description: 'Prompt holding the preview on screen until the user acknowledges it.',
  },
  'cli.history.backToMenu': {
    description: 'The single row of that prompt. Rendered after a "←  ".',
  },
  'cli.history.noChangesToSave': {
    description: 'Exiting the history editor with nothing to write.',
  },
  'cli.history.saved': {
    description:
      'Confirms the changelog was written. {file} is a filesystem path; the English "(s)" is a legacy contraction.',
  },
  'cli.history.discardedAll': {
    description: 'Confirms the history editor exited without writing anything.',
  },

  'cli.lineMutate.appendIntoOpenFence': {
    description:
      'Refusal to append a card line to a file that ends inside an unclosed markdown code fence, where the line would be read as prose. Exits 2.',
  },
  'cli.lineMutate.targetLineGone': {
    description:
      'The line a one-shot edit resolved to was gone by the time the edit applied. Exits 1.',
  },
  'cli.lineMutate.conflictingLabels': {
    description:
      'Refusal to rewrite a collection line whose labels token the parser will not read, since the rewrite would silently drop it. {token} is the raw token text and never translates.',
  },
  'cli.lineMutate.finishWithoutPrinting': {
    description:
      'Refusal to write a foil or etched finish onto a card line that names no specific printing. {finish} is the finish slug (foil/etched) and never translates, as do the two flag names.',
  },

  'cli.csvUpload.flagAdvice': {
    description:
      'How to settle the CSV question without a terminal. Spliced onto the end of the two messages below; the flag names never translate.',
  },
  'cli.csvUpload.tooMany': {
    description:
      'Why a collection push stopped. {cards} is an already-rendered count and noun, {threshold} the limit that was passed, {searches} how many Archidekt requests the slow path would cost, {advice} the sentence above.',
  },
  'cli.csvUpload.prompt': {
    description:
      'The same situation, asked as a question because a terminal is available. {cards} arrives already counted (from domain.count.cards) while {count} selects the form, because the pronoun in the question ("it"/"them") agrees with it. Archidekt is a product name.',
  },
  'cli.csvUpload.optionUpload': {
    description: 'The row letting Ritual upload the CSV itself — the recommended answer.',
  },
  'cli.csvUpload.optionExport': {
    description: 'The row writing the CSV to disk for the user to upload by hand.',
  },
  'cli.csvUpload.optionIndividual': {
    description:
      'The row adding each card through its own request; the parenthetical warns what that costs.',
  },
  'cli.csvUpload.optionCancel': { description: 'The row abandoning the push entirely.' },
  'cli.csvUpload.cancelled': {
    description: 'Reported when the user declined every answer, so nothing was pushed.',
  },
  'cli.csvUpload.promptPath': {
    description:
      'Prompt for where to write the CSV. {url} is the Archidekt import page and never translates.',
  },
} as const satisfies MetaFor<typeof cliEditMessages>
