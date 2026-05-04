# TODO

## Admin Site

- Add "quick add" feature that works like CLI collection prompts UI but for the browser.
- Add ability to add new decks or collection files (or wanted lists once those are implemented).
- Add default settings for adding new cards (like the collection CLI) for edit deck/collection pages.

## Public Site

- Add more filtering options (scryfall syntax?)
- Add filtering printings from appearing as default
- Add search
- Allow downloading deck info as JSON, CSV pre-rendered
- Remove card count from deck list (display format instead)
- Allow grouping by format for deck list page

## Other commands

- Add customizable CSS, layout, for site generator
- Allow exporting deck information to be used by other tooling
- Add scryfall interactive mode
- Add interactive deck builder

## Dist

- Distribute on NPM (?)

## Misc

- Multi-language support
- Add note to existing card (separate command)
- Fix colors of index price text
- If a card has no price, display "N/A" in the price font style
- Add "last updated" timestamp to collection and deck files, and display this in the UI
- Add "created at" timestamp to collection and deck files
- Replace editor and manager pages in admin site with unified interface
- When removing a card from a deck, if it's not from the mainboard, then the change log should state what section it was removed from
- When moving a card between sections, change events should say which sections it was moved between
- `--dev` mode for cache server
