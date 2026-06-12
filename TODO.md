# TODO

## Public Site

- Add more filtering options (scryfall syntax?)
- Add filtering printings from appearing as default
- Allow downloading deck info as JSON, CSV pre-rendered

## Other commands

- Allow exporting deck information to be used by other tooling
- Add scryfall interactive mode
- Change the discard feature to work with all changes and have it be more of a "view changes" menu with the option to remove
- Allow compacting changes when combining them with the history tool (i.e. an add followed by a remove should be treated as a single change)
- Assume temporal stability by default in history tool (newer edits go on the bottom always when combining unless otherwise specified)

## Misc

- Multi-language support
- Fix colors of index price text
- Add "last updated" timestamp to collection and deck files, and display this in the UI
- Add "created at" timestamp to collection and deck files
- When removing a card from a deck, if it's not from the mainboard, then the change log should state what section it was removed from
- When moving a card between sections, change events should say which sections it was moved between
- `--dev` mode for cache server
