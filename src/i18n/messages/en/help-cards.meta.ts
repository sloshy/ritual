/** Translator metadata for {@link helpCardsMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { helpCardsMessages } from './help-cards'

export const helpCardsMeta = {
  'help.listArg.crossType': {
    description:
      'Help for the list-name argument shared by add-card, remove-card, set-card and note. "type flag" means --deck/--collection/--wanted.',
  },
  'help.listArg.prefixed': {
    description:
      'Help for the list-name argument of `delete` and `rename`. The three prefixes are file-format vocabulary and never translate.',
  },
  'help.listFlags.deck': {
    description: 'Help for the shared --deck flag: read the given name as a deck name.',
  },
  'help.listFlags.collection': {
    description: 'Help for the shared --collection flag: read the given name as a collection name.',
  },
  'help.listFlags.wanted': {
    description: 'Help for the shared --wanted flag: read the given name as a wanted-list name.',
  },
  'help.listScope.deck': {
    description:
      'Help for the shared --deck flag where it scopes a multi-list run (export/price/sell) to decks.',
  },
  'help.listScope.collection': {
    description:
      'Help for the shared --collection flag where it scopes a multi-list run (export/price/sell) to collections.',
  },
  'help.listScope.wanted': {
    description:
      'Help for the shared --wanted flag where it scopes a multi-list run (export/price/sell) to wanted lists.',
  },
  'help.cardId.disambiguate': {
    description:
      'Help for the shared --card-id flag. "&N" is the literal id syntax written in list files and never translates.',
  },

  'help.addCard.description': { description: 'One-line summary of the `add-card` command.' },
  'help.addCard.cardName': { description: "Help for add-card's card-name argument." },
  'help.addCard.collectionFlag': {
    description:
      "add-card's --collection flag: unlike elsewhere, a missing collection is created by the add.",
  },
  'help.addCard.wantedFlag': {
    description:
      "add-card's --wanted flag: unlike elsewhere, a missing wanted list is created by the add.",
  },
  'help.addCard.quantity': {
    description:
      'Help for add-card --quantity. Only decks carry a per-line quantity; the other list types are one card per line.',
  },
  'help.addCard.finish': {
    description:
      'Help for add-card --finish. The three finish names are machine values and never translate.',
  },
  'help.addCard.condition': {
    description:
      'Help for add-card --condition. The grade abbreviations and NONE are machine values and never translate.',
  },
  'help.addCard.language': {
    description:
      'Help for add-card --language. This is the *card printing* language (a Scryfall code), never the interface locale. "defaultLanguage" is a config key and "en" a language code; neither translates.',
  },
  'help.addCard.label': {
    description:
      'Help for add-card --label. "sale", "trade", "keep" and "proxy" are persisted label slugs and never translate.',
  },
  'help.addCard.tag': {
    description:
      "Help for add-card --tag: the owner's free-form tags the new card line starts with. The quoted example shows two comma-separated tags; its words may be localized, the comma stays.",
  },
  'help.addCard.section': { description: 'Help for add-card --section (deck sections only).' },
  'help.addCard.commander': {
    description:
      'Help for add-card --commander. "Commander" is the deck section\'s literal name in the file.',
  },
  'help.addCard.exact': { description: 'Help for add-card --exact (skip the card picker).' },
  'help.addCard.set': { description: 'Help for add-card --set, which pins a printing.' },
  'help.addCard.collectorNumber': {
    description: 'Help for add-card --collector-number, which pins a printing.',
  },
  'help.addCard.nameOnly': {
    description: 'Help for add-card --name-only, a wanted-list-only specificity choice.',
  },
  'help.addCard.specific': {
    description: 'Help for add-card --specific, a wanted-list-only specificity choice.',
  },
  'help.addCard.dryRun': { description: 'Help for add-card --dry-run.' },

  'help.removeCard.description': { description: 'One-line summary of the `remove-card` command.' },
  'help.removeCard.cardName': {
    description: "Help for remove-card's card-name argument; matching is fuzzy.",
  },
  'help.removeCard.quantity': { description: 'Help for remove-card --quantity (decks only).' },
  'help.removeCard.allCopies': { description: 'Help for remove-card --all-copies (decks only).' },
  'help.removeCard.dryRun': { description: 'Help for remove-card --dry-run.' },

  'help.setCard.description': { description: 'One-line summary of the `set-card` command.' },
  'help.setCard.cardName': { description: "Help for set-card's card-name argument." },
  'help.setCard.set': { description: 'Help for set-card --set.' },
  'help.setCard.collectorNumber': { description: 'Help for set-card --collector-number.' },
  'help.setCard.finish': {
    description:
      'Help for set-card --finish. {finishes} is the comma-joined list of finish names, which are machine values.',
  },
  'help.setCard.language': {
    description:
      'Help for set-card --language: the card printing language, not the interface locale. "en" is a language code.',
  },
  'help.setCard.condition': {
    description:
      'Help for set-card --condition. {choices} is the comma-joined grade list; NONE clears a recorded grade.',
  },
  'help.setCard.label': {
    description:
      'Help for set-card --label. The label slugs and "none" are machine values; decks carry "proxy" alone.',
  },
  'help.setCard.tag': {
    description:
      "Help for set-card --tag, which adds tags to a card's line without touching the ones it has. The quoted example shows two comma-separated tags; its words may be localized, the comma stays.",
  },
  'help.setCard.untag': {
    description: "Help for set-card --untag, which removes the named tags from a card's line.",
  },
  'help.setCard.art': {
    description:
      'Help for set-card --art, which records a replacement image for one card. "none" is a machine value; the art directory is the configured artDir.',
  },
  'help.setCard.section': { description: 'Help for set-card --section (decks only).' },
  'help.setCard.commander': { description: 'Help for set-card --commander (decks only).' },
  'help.setCard.noCommander': { description: 'Help for set-card --no-commander (decks only).' },
  'help.setCard.dryRun': { description: 'Help for set-card --dry-run.' },

  'help.note.description': { description: 'One-line summary of the `note` command.' },
  'help.note.cardName': { description: "Help for note's card-name argument." },
  'help.note.note': { description: 'Help for note -n/--note, which supplies the note text.' },
  'help.note.clear': { description: 'Help for note --clear, which removes an existing note.' },
  'help.note.dryRun': { description: 'Help for note --dry-run.' },

  'help.setListImage.description': {
    description: 'One-line summary of the `set-list-image` command.',
  },
  'help.setListImage.card': {
    description:
      'Help for set-list-image --card. "&N" is the literal id syntax used in list files and never translates.',
  },
  'help.setListImage.file': {
    description:
      'Help for set-list-image --file. The art directory is the configured artDir; the path is relative to it.',
  },
  'help.setListImage.url': {
    description:
      'Help for set-list-image --url. The build never validates it — the browser is what fetches it.',
  },
  'help.setListImage.default': {
    description:
      "Help for set-list-image --default, which removes the front-matter key. Ritual's own choice is the commander of a commander deck, otherwise the most expensive printing.",
  },
  'help.setListImage.dryRun': { description: 'Help for set-list-image --dry-run.' },

  'help.move.description': { description: 'One-line summary of the `move` command.' },
  'help.move.cardName': { description: "Help for move's card-name argument." },
  'help.move.from': {
    description:
      'Help for move --from. The three prefixes are file-format vocabulary; "Session Filters" names the screen the interactive session shows.',
  },
  'help.move.to': { description: 'Help for move --to, the destination list.' },
  'help.move.quantity': { description: 'Help for move --quantity.' },
  'help.move.cardId': {
    description:
      'Help for move --card-id, which selects the *source* card. "&N" is the literal id syntax.',
  },
  'help.move.set': { description: 'Help for move --set: it both narrows and assigns a printing.' },
  'help.move.collectorNumber': {
    description: 'Help for move --collector-number: it both narrows and assigns a printing.',
  },
  'help.move.finish': {
    description: 'Help for move --finish. {finishes} is the comma-joined list of finish names.',
  },
  'help.move.toSection': { description: 'Help for move --to-section (deck destinations only).' },

  'help.card.description': { description: 'One-line summary of the `card` command.' },
  'help.card.name': { description: "Help for card's name argument." },
  'help.card.fuzzy': { description: 'Help for card --fuzzy.' },
  'help.card.set': { description: 'Help for card --set, which scopes the lookup to one set.' },
  'help.card.stdin': { description: 'Help for card --stdin (batch lookup).' },
  'help.card.fromFile': { description: 'Help for card --from-file (batch lookup).' },

  'help.scry.description': { description: 'One-line summary of the `scry` command.' },
  'help.scry.query': {
    description: "Help for scry's query argument. Scryfall's query syntax itself never translates.",
  },
  'help.scry.pages': {
    description: 'Help for scry --pages. {max} is the hard page cap, a courtesy bound on the API.',
  },
  'help.scry.random': { description: 'Help for scry --random.' },
  'help.scry.count': { description: 'Help for scry --count. {max} is the hard cap.' },

  'help.diff.description': { description: 'One-line summary of the `diff` command.' },
  'help.diff.listA': {
    description: "Help for diff's first list argument. The prefixes never translate.",
  },
  'help.diff.listB': {
    description: "Help for diff's second list argument. The prefixes never translate.",
  },
  'help.diff.by': {
    description: "Help for diff --by. 'name' and 'printing' are machine values.",
  },

  'help.new.description': { description: 'One-line summary of the `new` command.' },
  'help.new.type': {
    description: "Help for new's type argument. The three type slugs are machine values.",
  },
  'help.new.name': { description: "Help for new's name argument." },
  'help.new.format': {
    description:
      'Help for new --format. "commander" is a format slug and never translates; the trick it describes (pass an invalid value to see the list) is deliberate.',
  },
  'help.rename.description': { description: 'One-line summary of the `rename` command.' },
  'help.rename.newName': { description: "Help for rename's new-name argument." },
  'help.delete.description': {
    description:
      'One-line summary of the `delete` command. "sidecar files" are the .sha256/.changes.md companions of a list.',
  },
  'help.delete.confirm': {
    description:
      "Help for delete --confirm: the value must equal the list's display name for the deletion to proceed.",
  },

  'help.lists.description': { description: 'One-line summary of the `lists` command.' },
  'help.lists.deck': { description: 'Help for lists --deck (filter the listing to decks).' },
  'help.lists.collection': {
    description: 'Help for lists --collection (filter the listing to collections).',
  },
  'help.lists.wanted': {
    description: 'Help for lists --wanted (filter the listing to wanted lists).',
  },
  'help.listAllCards.description': {
    description: 'One-line summary of the `list-all-cards` command, plus its intended CI use.',
  },
  'help.listAllCards.out': {
    description: "Help for list-all-cards --out. The '-' value is machine vocabulary.",
  },

  'help.metadata.description': { description: 'One-line summary of the `metadata` command group.' },
  'help.metadata.set': { description: 'One-line summary of `metadata set`.' },
  'help.metadata.get': { description: 'One-line summary of `metadata get`.' },
  'help.metadata.list': { description: 'One-line summary of `metadata list`.' },
  'help.metadata.unset': { description: 'One-line summary of `metadata unset`.' },
  'help.metadata.listName': {
    description: 'Help for the list-name argument the four metadata subcommands share.',
  },
  'help.metadata.property': {
    description:
      'Help for the metadata <property> argument. {keys} is the comma-joined list of deck front-matter keys; "description" and "labels" are the flat-list keys. All are machine names.',
  },
  'help.metadata.value': { description: 'Help for the metadata set <value...> argument.' },
  'help.metadata.add': {
    description: 'Help for metadata set --add. "tags" and "labels" are the two array properties.',
  },
  'help.metadata.remove': { description: 'Help for metadata set --remove.' },

  'help.cleanup.description': { description: 'One-line summary of the `cleanup` command.' },
  'help.cleanup.dryRun': { description: 'Help for cleanup --dry-run.' },
  'help.cleanup.skipFormats': { description: 'Help for cleanup --skip-formats.' },
  'help.cleanup.check': {
    description:
      'Help for cleanup --check. "exit 1" names the process exit code, which is locale-invariant.',
  },

  'help.getPrimer.description': { description: 'One-line summary of the `get-primer` command.' },
  'help.getPrimer.source': {
    description:
      "Help for get-primer's source argument. The example deck slug is illustrative and may be left as-is.",
  },
  'help.getPrimer.moxfieldUserAgent': {
    description:
      'Help for get-primer --moxfield-user-agent. "Moxfield", "User-Agent" and the env var name never translate.',
  },
} as const satisfies MetaFor<typeof helpCardsMessages>
