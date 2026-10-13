# Changelog

Notable changes a Ritual user would notice. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and each release's section here
is also its notes on the [releases page](https://github.com/sloshy/ritual/releases).

**Ritual is in 0.x.** Until 1.0, any release may change commands, flags, output formats,
MCP tools and the like; each change that needs something from you says so here.

**Your data carries forward.** Your decks, collections, wanted lists, their changelogs and
your `ritual.config.json` keep working as you upgrade from one version to the next. When a
release changes a file format or a generated file, it ships the change as a
`ritual migrate` migration, and Ritual tells you when one is pending.

## [Unreleased]

### Added

- Every page of a site `build-site` produces now carries, in its footer, the notice Wizards
  of the Coast's Fan Content Policy asks for, and credits Scryfall for the card data and
  images.
- Ritual offers its source on every network surface, as its license (AGPL-3.0) asks: a
  built site's footer, the admin site's navigation (and `GET /api/status`'s new `about`),
  and the MCP server's instructions name the running version and link to that version's
  source. A fork sets `RITUAL_SOURCE_URL` when it builds to point them at its own
  repository.
- Every release binary is published with a build provenance attestation. Check a download
  with `gh attestation verify <file> --repo sloshy/ritual`.
- `deck-sync pull` and `deck-sync push` take `-v, --verbose` to list every card a run
  changes under its deck's `Changes:` count: additions, removals, quantity changes, board
  moves, printing changes and category changes, one line each. A run without it that had
  cards to list ends with a hint naming the flag. The same cards are available as data:
  each deck in the `--output json` report, the admin `POST /api/deck-sync` response and the
  MCP `sync_decks` result carries a `changes` list. The admin Sync Decks page always shows
  the listing, including when it falls back from the progress stream.
- `collection-sync pull` and `collection-sync push` take `-v, --verbose` too, listing every
  card each list gains or loses (and, on a push, what the CSV import or `--csv-file` took)
  in the same `+ 2 Sol Ring (C21:240) to Blue Binder` form. The same cards are in each
  list's new `changes` in the `--output json` report, the admin `POST /api/collection-sync`
  response and the MCP `sync_collection` result, and a push's deletions of cards no list
  holds are in the new `unlisted`. A card the CSV import created is marked `via: "csv"`.
  The admin Sync Collection page shows the listing.

### Changed

- `collection-sync push` now prints a `Changes: +N added, -N removed` count per list instead
  of one `Added 2 × Sol Ring (C21:240).` line per card. The per-card lines are behind
  `--verbose`, worded as `+ 2 Sol Ring (C21:240) to Archidekt`, and a dry run no longer says
  `[dry-run] Would add …`. Update any script that matched the old lines.
- The admin Sync Decks and Sync Collection pages' fallback for when the progress stream
  cannot connect now shows each deck's or list's `Changes:` count and per-card lines, as
  the stream does.
- Deck-sync and collection-sync output follows the UI language: the CLI prints it in yours,
  and the admin Sync Decks and Sync Collection pages show it in the browser's, relabelling
  a finished run when you switch. JSON reports, the admin API and MCP results stay in
  English.
- **Sync reports carry an `outcome` code; scripts should branch on it, not on `reason`.**
  Each deck and collection list in a `deck-sync` or `collection-sync` report (CLI
  `--output json`, the admin API, MCP `sync_decks`/`sync_collection`) now has `outcome`:
  `changed`, `unchanged`, `dry-run`, `cancelled` or `not-run` (absent on a failure or
  another kind of skip). `changed` includes copies a push wrote to its `--csv-file` for
  upload; a deck push whose changes all turned out to be what Archidekt already holds is
  `unchanged` (its `--dry-run` preview too, which used to say "would push 0 card changes"). `reason` stays English, with `reasonKey` and `reasonParams` beside it, and a
  collection report adds `errorMessages` beside `errors`. The same key and params ride
  beside the English on the admin API's streamed `log` events, on a CSV import's `failed`
  outcome (`messageKey`, `messageParams`), and on a CSV failure row Ritual could not match
  to a card (`cardKey`, `cardParams`). Update any script that matched `reason` against
  `no changes`, `cancelled before it started` or `dry-run:`.
- A collection sync that stops before reaching its lists (a bad `--into` or
  `--removal-priority`, an unresolved ambiguous removal, or additions a push will not
  send) now reports those lists `skipped` with the outcome `not-run` and the reason "not
  synced: the run stopped before this list", instead of `synced` as if they had been
  compared and found unchanged, or (for a bad destination) leaving them out. A list's
  reason no longer repeats once per CSV row Archidekt refused. A list that failed stays
  `failed` when the run is then cancelled, and a push preview's lists carry the same "dry-run: …" summary a pull's
  do.
- Some sync wording changed:
  - A count of one reads in the singular: "Pushed 1 card change to Archidekt", and "did
    not import 1 of 1 CSV row".
  - A list of collection lists, or of removals a pull could not place, ends with a serial
    comma and "and", in the UI language's own list style ("A, B, and C"). Unplaced
    removals used to be joined by commas alone.
  - A deck that cannot be synced is named before the reason, as in "Deck "Name": not
    sourced from Archidekt" (or "Skipping file.md: …" in an all-decks run), and a deck file
    that cannot be read reports "could not read the deck file: …".
  - A push that cannot find a card on Archidekt says "Cannot remove Sol Ring: the
    Archidekt deck does not hold it" instead of "Cannot remove for card not found in
    Archidekt deck: Sol Ring".
  - The rate-limit notice spells its wait out: "waiting 2 seconds before retry 1 of 5"
    instead of "waiting 2s", and a minute or more reads as minutes.
- The admin API's messages follow the admin site's language. Every admin API refusal and
  success message that has a catalog entry now carries its `messageKey` (and
  `messageParams`), so the admin pages show it in the browser's language and relabel it
  when you switch, as they already did for sync runs; the rest (an engine's own wording,
  such as a malformed set code or CSV column spec) are English text and gain a key as
  their modules are converted. `message` stays English for MCP clients and scripts,
  including a keyed error a route raises internally, which used to follow the server's UI
  language. Such an error now also answers with its own status (`400` for a usage error,
  `404` for a missing list) where some routes answered `500`. A network failure in the
  card-art and metadata dialogs reads "Save failed: …" instead of the bare browser
  error. `diff` and `export` refuse a list that does not resolve with the list
  resolver's own keyed message, and `import-changes` reports it as that list's keyed
  `error`. The Audit Log page shows each stored reason in the browser's language; the log
  file keeps the same English. `ritual metadata set` and `ritual set-list-image`, which
  share the admin route's validation, print its keyed refusals in the CLI's language (the
  rest in English), and their `--output json` error envelopes carry its `messageKey` and
  `messageParams`; `ritual import-changes` prints a failed list's reason in the CLI's
  language too.
- Why a change bundle, a save or a history rewrite was refused now follows the UI
  language. `ritual import-changes` prints an invalid bundle's reason
  (`Move #1 "from" is not an object.`) in the CLI's language, and the admin Import
  Changes page and the editors' Load Changes dialog show it in the browser's,
  relabelling it when you switch.
  The admin `POST /api/import-changes` refusal of a malformed bundle, a list save refused
  for a change it cannot decode, for a collection change missing its printing, or for
  changes that did not apply, and a history rewrite refused for an event it cannot decode
  now carry `messageKey` and `messageParams` beside the same English `message`; the
  params nest (the change or move a problem is about is a message of its own), and the
  admin editors show the save refusals in the browser's language (a collection-sync pull
  that aborts on them reports them in the CLI's). The API's `message` and MCP results
  stay English, and `import-changes --output json` keeps its `messageParams` English
  while its `message` follows the CLI's language.
- A save refused because its changes did not apply counts them in the singular when
  there is one: "1 change matched no card in deck "burn": …", "1 change never applies to
  a collection list: …" (they read `1 change(s) …`). The change descriptions inside it
  and in its `unmatched` list are always English now, where they followed the server's
  UI language. A label, tag or category rule a change or move broke is set off from the
  record by a colon: `Move #1: 'keep' cannot be combined with other labels.` (it read
  `Move #1 'keep' cannot …`). Update any script that matched `change(s)` or these
  sentences, or match on `messageKey`.
- A move's description in the CLI and both web apps names the other list in the UI
  language (`Deck 'Burn'` was always English). The `.changes.md` line it is recorded as
  is unchanged.
- `ritual detect-changes` reports a failed git command in the CLI's language.
- The card cache's own messages follow the UI language. The CLI prints the cache offers
  and progress before `add-card`, `edit`, `price`, `sell`, `build-site` and `serve --api`
  (and `admin` at startup), a cache-lock wait or time-out, a cache-feed sync's progress
  and errors, and a malformed `--cache-server` / `RITUAL_CACHE_SERVER` in yours; so do the
  cache server's, the feed host's and the admin server's consoles. In `--output json` the
  error envelope's `message` for a cache-lock time-out, a failed `--cache-server` request
  or a malformed cache-server address follows the UI language too. Lock files, feed state
  and the card-bulk record are unchanged bytes.
- **More `--output json` error envelopes carry a `messageKey`.** Any keyed engine error a
  command fails with now carries its key and params beside `code` — a cache-lock time-out
  (`domain.cache.lockTimedOut`), a failed `--cache-server` request
  (`domain.cache.serverRequestFailed`, …), and the sync engines' own keyed failures (a
  `deck-sync link` that cannot write the deck, a collection list that disappeared mid-run,
  …). A param that nests (a duration, a message inside the message) is given as its English
  rendering, so `messageParams` stays flat strings and numbers in English whatever the UI
  language, while `message` follows it. Match on `code` and `messageKey`.
- **A cache-lock time-out reaches the admin API in English, keyed.** When a refresh gives up
  on another process's cache lock, `POST /api/cache/refresh`, the cache refresh stream's
  `error` event and any other route that refreshes the cache now answer in English with
  `messageKey: "domain.cache.lockTimedOut"`; it used to be unkeyed English with only its
  duration in the server's UI language. A failed request to a `--cache-server` is keyed
  the same way (`domain.cache.serverRequestFailed`, …) wherever it surfaces, the card routes
  (`/api/card-details`, `/api/card-printings`, `/api/card-price`, `/api/cards`,
  `/api/card-search`) included, which used to answer it in the server's UI language. Their
  `messageParams` nest: the time-out's `timeout` is a new duration param `{ durationMs }`
  and its `holder` is a message of its own. Any route's error body, and the sync and build
  streams' `error` events, may now carry nested `messageParams`; a script reading them must
  accept objects, not only strings and numbers. MCP tool errors (`refresh_cache`,
  `get_card_details`, …) carry only `{ error, code, message }`: their `message` is now
  English for these errors too, but has no key, so branch on `code`. `GET /api/card-search`
  also refuses an invalid `warm` in English keyed `errors.enum.invalid` (it followed the
  server's UI language). On the admin Refresh Cache page the card-cache refresh's outcome
  shows in the browser's language and relabels when you switch (the Card Kingdom buylist
  card does not yet), and a progress stream that drops mid-refresh now says so instead of
  starting a second refresh.
- A collection-sync push's CSV cache check is keyed: its "Refreshing it from Scryfall
  first..." line carries `messageKey` on the run log (the admin stream's `log` events,
  the Sync Collection page), and its refusal in `errors` / `errorMessages` (CLI
  `--output json`, `POST /api/collection-sync`, MCP `sync_collection`) is
  `domain.sync.nothingPushed` with the `domain.cache.*` reason nested as `message`, where
  it was unkeyed text. The English is unchanged; match on the keys.
- Two cache messages count their nouns properly: the stale-price notice before a site build
  or `serve --api` says "150 of 300 cards have prices older than 24 hours." (it read
  `card(s)`), and a feed download from one peer ends "(1 peer)." (it read "1 peers").
  Update any script that matched `card(s)`.
- **The admin server refuses in the shared error envelope.** A `401` (no session), a `403`
  (before the first account exists, or from the IP/User-Agent allow and deny lists), a
  `404` for a path with no route or file, and an unexpected `500` now answer
  `{ "success": false, "message", "messageKey" }` instead of `{ "error": "…" }` or a plain
  text body. A locked-out sign-in's `429` carries `message` instead of `error`, beside
  `retryAfterSeconds`. Update any script that read `error` off these responses.
- The import results build their summary from counted nouns, so a client pluralizes them
  in its own language: `POST /api/import-csv`, `POST /api/import-deck` and
  `POST /api/import-changes` (and the MCP `import_csv`, `import_deck` and
  `import_change_bundle` results, and `import-changes --output json`) carry `messageKey`
  and `messageParams` whose params may nest. A change-bundle import's failed list carries
  `errorKey` and `errorParams` beside `error`.
- Some admin import wording changed. In the summary `message` of the import routes and
  tools, a count of one reads in the singular and the `(s)` plurals are gone: "Imported 1 card into collection 'Binder'; 1 row failed validation",
  "Successfully imported 'Burn' — 1 line could not be parsed and was skipped". A CSV
  import into a wanted list names it as one: "into wanted list 'Wishlist'" (it read "into
  wanted 'Wishlist'"). Update any script that matched `card(s)`, `row(s)`, `line(s)` or
  `note(s)` in these messages — or, better, match on `messageKey`.
- Some admin refusals are worded more consistently: a field that must be true or false
  reads "`<field>` must be a boolean." everywhere (the sync routes and a deck import's
  `overwrite` gain the period; a list save's `"continueSession"` and `"validateCardNames"`
  lose their quotes), a deck import's non-text `name` reads "name must be a string.", and
  a history or price request for a list that does not exist names its type ("Deck 'burn'
  not found") instead of "List 'burn' not found".
- **`deck-sync push` now moves cards between boards.** A push diffs per board the way a pull
  does, so a card that is in Main locally but in the Maybeboard on Archidekt (or any other
  board pair) is moved there on Archidekt, instead of the push doing nothing. The existing
  Archidekt entry keeps its label, printing and role categories; only its board category
  changes. New cards are added to their local board's category; a new Main card with no
  other category still gets Archidekt's default. A copy removed from one board removes
  only that board's entry.
- `deck-sync pull` now moves a line whose card changed board on Archidekt instead of
  removing and re-adding it, so it keeps its `&N` ID, tags, labels, note, condition and
  language, and the changelog records a section move. When only some of a line's copies
  moved, the line keeps the rest, and the moved copies become a new line with a new `&N`.
  A section a pull leaves empty is now removed (an emptied `## Commander` no longer stays
  behind as a bare header); empty `## Main` and `## Sideboard` headers are still kept.
- Both directions report `N board moves` in their summary and a `boardMoves` count in each
  deck's structured result (`--output json`, the admin API, MCP `sync_decks`). `--only`
  never drops a move, since a move changes no copy count. There is no flag: if you relied
  on pushes ignoring boards, review a `deck-sync push --dry-run` first.
- Interactive menus and card pickers in the CLI now size themselves to your terminal's
  height instead of showing a fixed 10–22 rows, so a menu no longer scrolls in a tall
  window and every picker shows as many rows as the card list in `ritual edit` does.
- **Card labels now adjust the list default instead of replacing it.** A card line's label
  token can take a label away with `no-<label>`: `[trade,no-sale]` under a `sale` default is
  "for trade, not for sale", `[no-sale,no-trade]` is "no labels", and `[no-proxy]` marks a
  real card in a `proxy`-default deck. A plain label adds to the default, and one that cannot
  combine with an inherited label displaces it (`[keep]` under a `sale` default is just
  `keep`), so `[trade]` under a `sale` default now means `sale` and `trade`. List defaults stay
  positive only. `set-card --label` and `add-card --label` take the same signed values
  (`--label trade,no-sale`, `--label no-proxy`; `--label none` still clears), as do the MCP
  `add_card` and `apply_changes` `labels` fields and the admin save's `set-label` events. The
  label pickers in `ritual edit`, the admin and public editors, and the add-card dialog now
  offer the state you want (adding **No labels**, and **Not a proxy** on a deck, when the
  list has a default) and write the smallest token that gives it. The list view badges a
  negation as **Not a proxy** / **Not for sale** (a card tile strikes the label through, with
  that wording as its tooltip), toned by a new `--label-negated` theme variable. Deck
  copies merge onto a line by effective labels on every path, `add-card` included. A card's
  `labels` in `get_list`, the admin load routes and `--output json` can now hold `no-…`
  values, and every deck card and collection entry in those loads gains `effectiveLabels`,
  the labels in force resolved by the server. Imports land a line's labels the way a move
  does (a `[no-sale]` line from a `sale,trade` file stays for trade), and a Swap Printings
  move carries the card's labels, tags and note (a pinned name-only deck line is converted in
  place only when the copy's labels match it, so a pin never turns a proxy real or the reverse). A line whose labels token conflicts
  (`[sale,keep]`, `[sale,no-sale]`) now keeps its card (with the labels dropped and the usual
  warning), so `set-card --label` can find and repair it.
- Change bundles are now format version 3 (labels adjust the list default). A version-2
  bundle is refused as an unsupported version, and an edit session an older site saved in
  the browser is not restored; re-export it from an up-to-date site.
- Deleting a list (`ritual delete`, the admin site, or the MCP `delete_list` tool) moves its
  files into the workspace's `.trash/` folder instead of erasing them, so a deletion can be
  undone by moving them back. The JSON and API results name the folder in a new `trashDir`.
- `ritual migrate` (and `init-site`, when it applies pending migrations) copies
  `ritual.config.json` and every file a numbered migration will rewrite, delete or move into a
  `.backups/` folder first, and prints the folder.
- `init-site` and `ritual migrate` add `.trash/` and `.backups/` to the workspace's
  `.gitignore`.
- Ritual writes lists, their sidecars and changelogs, `ritual.config.json` and the saved
  logins through a temporary file and a rename, so a crash or a full disk mid-save can no
  longer leave one of them truncated. A symlinked file stays a symlink and keeps its
  permissions. On Linux and macOS, a read-only file no longer stops Ritual from replacing it;
  only a read-only folder does. In Docker, mount folders rather than single files.

- The cache feed (`cache feed`, `cacheSource: feed`) is marked experimental, and hosted mode
  (`serve --api`) and sell mode on the public and admin sites are marked beta, in the docs
  and in `--help`. `cache server` is labelled for trusted networks only.
- The GitHub Actions deploy workflow that `ritual init-site` generates checks the Ritual
  binary it downloads against the release's published SHA-256 checksum. `ritual migrate`
  brings an existing workflow up to date.
- The Docker image is tagged with each release's version, and `latest` now moves only for a
  stable release, never for a prerelease. A published image reports its release version
  and can pin a workspace's Ritual release like a release binary.
- `serve` no longer sends the server's stack trace to a visitor when a request fails.
- Moving a card to another list in an editor (the admin and public sites' **Move to list…**,
  the public site's **Move selected**, and `📤 Move to Another List` in `ritual edit`) keeps
  its note and labels, as `ritual move` does. Every move, `ritual move` included, now carries
  the card's labels as its list states them, so a card that only inherited `proxy` from its
  deck's default stays a proxy in the collection it moves to, and a real card stays real in a
  `proxy`-default list (written `[no-proxy]`). A `sale`/`trade`/`keep` state the source list
  stated, in its default or on the card, is kept, and a label it never stated takes the
  destination's default. The destination keeps the labels its type accepts (`proxy` into a
  deck, `sale`/`trade`/`keep` only into a collection, nothing into a wanted list) and writes
  the smallest token that says so. When the
  copy merges onto a deck line that already has a different note, the line keeps its own,
  and the drop is reported once per note by the admin editor's save, `ritual edit`, and
  `ritual import-changes` (whose results, the admin Import Changes page and the MCP
  `import_change_bundle` tool now list each list's `droppedNotes`). Public-site change
  bundles carry a move's `labels` and `note`.
- The Docker image creates `/app/wanted`, keeps `/app/.logins` private (mode 0700), and exposes the default ports of `admin` (8080)
  and `cache server` (4000) as well as `serve` (3000).

### Fixed

- Adding a card to a named deck section (`add-card --section`, MCP `add_card` and
  `apply_changes` with a `section`, a change-bundle import, a changelog replay) now merges
  only with a line of the same printing in that section, instead of folding onto a matching
  line elsewhere in the deck. Without a section, copies still join a matching line anywhere.
- A section name given to `add-card --section`, `set-card --section`, or the MCP tools now
  resolves to the deck's own section: case-insensitively (`sideboard` is `## Sideboard`),
  and by role (`Main` or `Deck` is the deck's first main-deck section, such as
  `## Creatures`, or the card lines above the first heading), instead of creating a
  near-duplicate section. `Signature Spell` and `Oathbreaker` stay separate sections, and
  `set-card --section` records the section the card landed in.
- An add with no section (or a card leaving the command zone) now lands in the same section
  through every path, CLI and editors alike: the card lines above the first heading when
  the deck has any, else the first main-deck section, never a Commander, Oathbreaker,
  Signature Spell, Companion, Sideboard, or extras section.
- A move that takes a copy out of another list (a bundle import, a swap) now prefers the
  source line whose labels match the copy, so a `[proxy]` copy leaves from the proxy line.
  Printing still comes first: an exact-printing line is taken before a name-only one.
- A moved copy landing in a deck now merges the same way on every path: with
  `ritual move --to-section` (or a move naming its section) only within that section,
  otherwise with a matching line in any section — `ritual move` used to look only in the
  default section — and labels are compared as effective labels, so a redundant `[proxy]`
  line in a `proxy`-default deck takes an arriving proxy.
- The web editors land an imported move the way the save replays it, against the list's
  default labels, so a proxy imported into a `proxy`-default deck no longer shows (or saves
  into the editor's baseline) as a separate line.
- Adding a copy of a tagged collection or wanted-list card in the web editors no longer
  shows the new copy untagged.
- Change-bundle and changelog refusals of a bad label set are reported in English whatever
  the UI language, and a bundle move with a malformed card id is refused.
- Moving a `[ja]` deck card off the public site's deck page with **Move selected** keeps its
  language, and moving cards from the combined views keeps their tags.
- On Windows, a workspace git checks out with CRLF line endings (`core.autocrlf`) no longer
  shows every list as hand-edited, and its changelogs no longer read as empty history.
- `ritual admin` and `ritual mcp --transport http` report a busy port with a one-line error
  and exit code 1, like `ritual serve`.
- Moving the last card out of a deck section no longer deletes the section's heading; it
  stays, as it does when the card is removed. And an empty section heading other than
  `## Maybeboard`/`## Tokens` (an emptied `## Commander`, say) no longer makes the deck refuse
  later moves, saves and `cleanup`: it is read back and kept as a bare heading.
- `deck-sync` no longer reports printings as disagreeing for a card one side holds without a
  printing (a plain local deck pulled from Archidekt).
- The admin deck-sync and collection-sync routes refuse a `decks`/`lists` array of only blank
  names instead of syncing everything.
- Deck pages price each card at the finish it shows: a `[foil]` copy at its foil price, a
  printing sold only in foil at that price instead of "N/A". The deck's card modal, its total
  on the site's index and `ritual price` follow, and under Card Kingdom a non-English copy
  is unpriced rather than priced at the English offer.
- A deck's card modal shows the printing of the line you clicked, as its tile does, rather
  than the deck's default printing of that card, and its Add to Trade adds that printing.
- Deck tiles and the deck card modal show a non-English card's language (`JA`), as collection
  and wanted-list tiles already did; the wanted-list card modal names it too.
- Prices in a card's Other Printings grid stay readable in light themes.
- In a card search (`ritual edit` and the sites' Add Card dialog), Esc first clears what you
  typed; a second Esc backs out or closes, as before.
- On a site built without `serve --api`, card search no longer lists a reversible printing
  ("Blood Crypt // Blood Crypt") as a card of its own, and picking it adds the card under its
  own name.
