# TODO

- Add scryfall interactive mode
- Allow adding/editing to multiple lists, or multiple kinds of lists, at once
- Allow saying you "used to have" a card, specifically when it's removed you can say where it went (sold to X, traded to Y)
- Allow importing lists of cards from text/json for the trade feature
- Git support from CLI commands (kinda dumb but someone might want this)
- Add list style views for modal dialogs like printings selection

- Sync decks on a schedule from a running server (the admin UI page is done)
- Card price tracking

- Confirm whether "don't care" is a valid option for a printing (default should be near-mint I think)
- Show prices when editing a card to be a different printing or edition
- Add ability to refresh cache while in edit mode so you don't lose progress

- Finish MCP Task migration (groundwork started, see research docs)

- Add support for labels, tags to cards
- Add ability to move cards on edit cli
- Show foil prices next to nonfoil where appropriate on cli edit listings
- Support alternate language printings

## Misc

- Multi-language support
- Fix colors of index price text
- Add "last updated" timestamp to collection and deck files, and display this in the UI
- Add "created at" timestamp to collection and deck files
- When removing a card from a deck, if it's not from the mainboard, then the change log should state what section it was removed from
- When moving a card between sections, change events should say which sections it was moved between
- `--dev` mode for cache server
