# TODO

## Admin Site

- Add "quick add" feature that works like CLI collection prompts UI but for the browser.
- Add ability to add new decks or collection files (or wanted lists once those are implemented).
- Add default settings for adding new cards (like the collection CLI) for edit deck/collection pages.

## Collection

- Display price of card when added
  - Also add this to the quick add admin site thing, and also for adding to decks once that is improved to be similar to the collection CLI.

## Static Site Generator

- Add more filtering options (scryfall syntax?)
- Add search
- Allow downloading deck info as JSON, CSV pre-rendered

## Other commands

- Add customizable CSS, layout, for site generator
- Allow exporting deck information to be used by other tooling
- Add scryfall interactive mode
- Add interactive deck builder

## Dist

- Distribute on NPM (?)
- Include licenses of dependencies in packages / containers

## Misc

- Multi-language support
- Trades page
- Wanted lists (functionally like collections, but without needing specific card details. Only name is required.)
- Add note to existing card (separate command)
- Move cards between collections
- Fix colors of index price text
- If a card has no price, display "N/A" in the price font style
- Normalize set codes to use lowercase consistently across the app
- Add "last updated" timestamp to collection and deck files, and display this in the UI
- Add "created at" timestamp to collection and deck files
- Really, REALLY double check the logic of editing a collection because the changes should keep track of exactly which card is removed (should use some kind of internal ID system)
