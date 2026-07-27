# TODO

- Add scryfall interactive mode
- Allow adding/editing to multiple lists, or multiple kinds of lists, at once
- Allow saying you "used to have" a card, specifically when it's removed you can say where it went (sold to X, traded to Y)
- Allow importing lists of cards from text/json for the trade feature
- Git support from CLI commands (kinda dumb but someone might want this)
- Add list style views for modal dialogs like printings selection

- Sync decks on a schedule from a running server (the admin UI page is done)
- Card price tracking
- Verify Archidekt's CSV-import `ifFound: add` semantics against a real account: upload one row for a
  printing the account already holds in a **different** condition or finish. If Archidekt matches on
  the Scryfall id alone, that row grows the existing record instead of creating the new variant — so
  the collection sync would re-upload the missing variant on every push, and the CSV path would have
  to be restricted to printings the account holds no record of at all
  (`ARCHIDEKT_CSV_IF_FOUND` in `src/importers/archidekt-collection.ts`)

- When adding a card in edit CLI, if you don't select a printing it just exits back to menu without an error. It should retry.
- When adding a card in edit CLI, you should be able to decide if you want to add an exact duplicate or another printing of the same card
- Confirm whether "don't care" is a valid option for a printing (default should be near-mint I think)
- Show prices on printings in edit CLI
- Show prices when editing a card to be a different printing or edition
- Add ability to refresh cache while in edit mode so you don't lose progress

## Misc

- Multi-language support
- Fix colors of index price text
- Add "last updated" timestamp to collection and deck files, and display this in the UI
- Add "created at" timestamp to collection and deck files
- When removing a card from a deck, if it's not from the mainboard, then the change log should state what section it was removed from
- When moving a card between sections, change events should say which sections it was moved between
- `--dev` mode for cache server
