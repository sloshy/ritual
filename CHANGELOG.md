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

- **One card cache for all your workspaces.** The Scryfall card cache (about 75 MB to
  download, a few hundred MB on disk) used to live in each workspace's own `cache/` folder;
  it now lives once per user account, so a second workspace reuses the first one's
  download: `$XDG_CACHE_HOME/ritual` (or `~/.cache/ritual`) on Linux,
  `~/Library/Caches/ritual` on macOS, and `%LOCALAPPDATA%\ritual\cache` on Windows. The
  `RITUAL_CACHE_DIR` environment variable, then a new `cacheDir` config key (`ritual config
set cacheDir …`, the admin Settings page, or MCP `update_config`), put it elsewhere; a
  relative path in either resolves against the workspace, so `cacheDir: "cache"` keeps the
  old per-workspace folder. `ritual cache status` (and `GET /api/cache/status`, MCP
  `get_cache_status`) reports the folder in use as `cacheDir` and which setting chose it as
  `cacheDirSource`, and the first download offer says where the data will go. Refreshes
  from different workspaces wait for one another on the cache's lock, and a running server
  reloads the cache file when another process rewrites it instead of saving an older copy
  over it. The Docker image sets `RITUAL_CACHE_DIR=/app/cache`, so its `/app/cache` volume
  is still where the cache lives.

  **Run `ritual migrate` in each existing workspace** (Ritual reminds you). Migration 3
  moves the workspace's `cache/` into the shared cache when that is still empty, so the
  first workspace you migrate keeps its download; for every later one, the shared cache
  already has data, so its `cache/` is left untouched and `migrate` tells you that Ritual no
  longer reads it and you can delete it. For a "Publish for me" site, `migrate` also
  refreshes the deploy workflow, which now sets `RITUAL_CACHE_DIR: cache` so CI keeps
  caching the checkout's `cache/` folder; commit the updated workflow. A hand-written CI job
  that caches `cache/` needs the same variable. A workspace without a `ritual.config.json` has nothing
  to migrate: its `cache/` is no longer read, so move its contents into the shared cache or
  delete it.

- The site's opening theme is now a setting, so a site built by the "Publish for me"
  workflow (which passes no theme flags) can open on a theme other than `default`.
  `site.theme` names a built-in theme (`-inverted` variants included), and
  `site.themeFiles` lists custom theme JSON files, relative to the workspace, that every
  build loads; `site.theme` may then name one of their themes. Set them with
  `ritual config set` or MCP `update_config`, or pick the theme from the admin Settings
  page's new **Site theme** select; the admin Build Site action and MCP `build_site` honour
  them too. `build-site --theme` and `--theme-file` (and `serve --build`) still win for one
  run, each over its own key. If you built locally only to get a theme, you can now let
  the workflow build instead.
- The MCP server supports the Tasks extension (`io.modelcontextprotocol/tasks`). For a
  client that declares it, such as Claude Code 2.1.304 or later, `build_site`, `sync_decks`,
  `sync_collection` and `refresh_cache` run as tasks: the call returns at once, the client
  polls the task's progress and can cancel it, and a `sync_collection` that needs to know
  which list loses a removed card asks through the task. A task's status line follows your
  interface language. Clients without the extension see no change.
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

- A sync no longer empties one side because the other is empty. `collection-sync pull`
  against an Archidekt collection with no cards (a new account, or one emptied elsewhere)
  used to delete every local copy without asking; it is now refused before anything is
  written, and so is a `collection-sync push` from collection lists that hold no cards.
  `deck-sync pull` of an Archidekt deck with no cards, and `deck-sync push` of an empty
  local deck, now fail that deck while the rest of the run carries on. Dry runs report the
  same refusal, and `--only additions` is never refused. The new `--allow-remove-all` flag
  on both commands (`allowRemoveAll` on the admin sync API and the MCP `sync_decks` and
  `sync_collection` tools) lets a run empty that side when you mean it; `--force` does not.
  A script that relied on an empty side clearing the other must add the flag.
- An invalid `site` block in `ritual.config.json` (any malformed field, such as a typo in
  `site.theme`) now stops `build-site`, and with it `serve --build`, the admin Build Site
  action, MCP `build_site` and the deploy workflow, with an error naming the field, and
  makes `serve --api`'s list requests fail. Before, the block was ignored with a warning
  and the build published every list, including ones you had excluded. Other commands
  still warn and carry on. If a build now stops here, fix the field it names.
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
- Moves name their lists in the UI language (`Deck 'Burn'` was always English): a move's
  description in the CLI and both web apps, the web apps' **Move to list…** picker, the
  CLI's `move` prompts, pickers, progress and result lines, and a move's refusals (a list
  that is gone, holds no copy to take, or cannot be read). The `.changes.md` line a move is
  recorded as is unchanged.
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
- **The card-cache refresh's progress lines are keyed.** Each `progress` event of
  `GET /api/cache/refresh/stream` now carries `messageKey` (a `domain.cache.refresh.*`
  message) and `messageParams` beside its unchanged `stage`, `percentage` and English
  `message`. The download sizes nest as a new size param, `{ sizeBytes }`, which a client
  renders as a two-decimal mebibyte figure in its reader's locale. The admin Refresh Cache
  page shows the line in the browser's language and relabels it when you switch, sizes
  included (German reads `36,25/72,50 MiB`). MCP `refresh_cache` progress notes are the same
  English as before.
- **A failed or cancelled card-cache refresh answers in English, keyed.** A refresh refused
  by Scryfall (the bulk manifest or the bulk download: `domain.cache.refresh.manifestFailed`,
  `domain.cache.refresh.bulkFetchFailed`, whose params are the HTTP `status` and
  `statusText`), a missing bulk URI, an empty download, a malformed bulk line
  (`domain.cache.refresh.invalidJsonLine`) and a cancelled refresh (the `499` body,
  `domain.cache.refresh.cancelled`) now reach `POST /api/cache/refresh` and the stream's
  `error` event with their key, where they were unkeyed text.
  So does a failed Scryfall request a route makes (a timed-out request,
  `domain.cache.scryfall.timedOut`, whose `timeout` is a duration `{ elapsedMs }`, and a
  failed symbology fetch, `domain.cache.scryfall.symbologyFailed`). A collection-sync push's
  CSV cache check that refreshes the cache and fails now nests the refresh's keyed failure as
  the `error` param of `domain.cache.downloadFailed` (it was a string). Their English is
  unchanged; match on the keys.
- **A cache server reports its failures in English, keyed, in one shape.** Every HTTP error
  `ritual cache server` answers (`400`, `404`, `405`, `500`) is now the admin API's refusal
  body, `{ "success": false, "message": …, "messageKey": …, "messageParams": … }`, with
  `message` English whatever the server's UI language. It replaces `{ "error": … }`, and the
  `500`'s fixed "Cache server request failed." line and `details`: the `500`'s `message` is
  now the failure itself. `POST /cache/prices/stream`'s `error` event carries the same
  triple beside `key`. A refusal is keyed `domain.cache.serverReply.*`: a path outside
  `/cache/` (which answered the plain text `Not Found`), an unknown section, route or
  method, a missing key, a body missing its `entries`, `keys` or `value`, and — new — a body
  that is not JSON or not a JSON object, or a key with a broken `%` escape, all `400`s where
  they used to fail as a `500`. A `--deny-http` server's refusal to download a price
  (`domain.cache.serverReply.httpDenied`) arrives as that price read's refusal or as a
  stream `error` event; a card miss still answers `{ "value": null }`. A Ritual client nests
  the reply into its own error, worded in its reader's language:
  `domain.cache.serverRequestFailedWithBody`'s `body` or a stream error's `error`, which now
  read as the server's reason ("…: Failed to fetch batch prices: 503 Service Unavailable")
  instead of the raw JSON of its reply. A stream error for one entry is the new
  `domain.cache.serverStreamEntryError`, which names the entry's `key` ("Cache server stream
  error for 'Sol Ring:usd': …"); `domain.cache.serverStreamError` is left for a failure of
  the whole stream. The admin API answers these errors in English with the keys; MCP tool
  errors carry the English `message` without them. A reply worded with a key or param this
  client does not know (a newer server's) is carried as the server's English text, and one
  that is not a message at all (an older server's body, a proxy's error page) is quoted as
  text, cut to about 1,000 characters and stripped of control characters (as is every text
  param of a nested reply). **Upgrade the
  cache server and its clients together:** an older Ritual client talking to this server
  quotes the new body's raw JSON as the reason, as it did before for every refusal. A script
  matching on the raw JSON or on `error` must match `messageKey` instead.
- **A cache server's console follows its UI language.** The server's console lines
  (listening, start-up and scheduled refreshes, feed fallbacks, failures) and the `--url` /
  refresh-interval refusals of `cache server`, `cache preload-all` and `cache feed` are
  worded in the UI language. The `[cache-server]` prefix and the `key=value` fields stay as
  they are, so **log filters must match the prefix and the fields, not the words around
  them**, which follow the UI language. **The `--verbose` request line is now `key=value`
  fields**, `[cache-server] method=GET path=/cache/cards/Sol%20Ring status=200 durationMs=3`
  (it read `GET /cache/cards/Sol%20Ring -> 200 (3ms)`): update any log filter that matched
  the old form.
- **A cache feed host refuses requests in English, keyed, like a cache server.** Every
  HTTP error `ritual cache feed host` answers (`400`, `404`, `405`, `416`, `503`) is now the
  JSON refusal body `{ "success": false, "message": …, "messageKey": … }`, with `message`
  English whatever the host's UI language (it was plain text: `Not found`,
  `Method not allowed`, `Invalid range`, `Feed not generated yet`). The keys are
  `domain.cache.feedReply.*`: `notFound`, `fileNotListed` and `torrentNotListed` for the
  three `404`s, `methodNotAllowed`, `rangeNotSatisfiable` and `notGenerated`. Routes,
  statuses and range handling are unchanged, except that a file or torrent name with a
  broken `%` escape is now a `400` (`pathMalformed`) where it crashed the request, and a
  `HEAD` ignores `Range` as HTTP requires. Refusals carry `Cache-Control: no-store`, a `405`
  names `GET, HEAD` in `Allow`, and the `503` sends `Retry-After: 60`. A cache server's
  `405` now names its methods in `Allow` too. Torrent web seeds read only the status, so
  they work with this host as before.
- **A failed cache feed download says what the host said.** When a feed host (or any
  server) refuses `cache feed fetch`, a feed-backed refresh or a cache server's feed sync,
  the error now names the URL and the HTTP status and nests the host's reason in your UI
  language ("Failed to fetch cache feed https://… (HTTP 503): The feed has not been
  generated yet."); another server's reply is quoted. It used to read "…: 503 Service
  Unavailable". These errors, and the feed client's other failures (a missing kind, a
  checksum mismatch, a torrent timeout), are keyed (`cli.cacheFeed.*`) where a keyed error
  is reported.
- **A failed Archidekt login says what Archidekt answered, keyed.**
  `ritual login archidekt` and the admin Archidekt Login page now name the HTTP status and
  Archidekt's own reason: "Login failed: Archidekt answered the login with HTTP 400: Unable
  to log in with provided credentials." (it read "Login failed: Login failed: 400 Bad
  Request"). The reason is read from Archidekt's reply (its `non_field_errors` and `detail`)
  and quoted on one line, capped; a reply without one (an error page) leaves the status alone.
  A login reply that holds no usable session is refused rather than stored, and only the
  session fields Ritual reads are written to the token file.
  **`POST /api/login/archidekt` answers by whose failure it was:** `401` only when Archidekt
  refused the credentials (a 4xx other than `429`), `502` when Archidekt failed (a 5xx, a
  `429`, a reply without a session), and `500` when this server did (a token file it could
  not write); every refusal was a `401`. Archidekt's refusals now carry `messageKey`
  (`domain.sync.auth.loginFailedWithReason`, `domain.sync.auth.loginFailed` or
  `domain.sync.auth.loginReplyInvalid`) and `messageParams` (`status`, `reason`), so the
  admin page words them in its reader's language. A stored session that cannot be refreshed
  before a sync logs one line in the UI language, "Could not refresh the Archidekt session:
  …", naming the status and reason the same way (it printed "Failed to refresh token:" and a
  stack trace), and a refresh that worked logs "Refreshed the Archidekt session." (it read
  "Token refreshed successfully.").
- **A failed Archidekt request says what Archidekt answered, keyed.** Fetching a deck
  (`ritual import` of an Archidekt URL, `deck-sync`, `build-site --decks <archidekt url>`,
  the admin Import Deck page), a deck list (`import-account`, `deck-sync push`'s ownership
  check), a page of a collection, a card search, and every write `deck-sync push` and
  `collection-sync push` make now fail with a sentence naming what failed, the HTTP status
  as a number, and Archidekt's own reason: "Failed to fetch Archidekt deck 123456 (HTTP
  404): Not found." (it read "Failed to fetch deck 123456: 404 Not Found"; a refused write
  read "createCollectionRecord failed (400): …" with the whole reply glued on). The reason
  is Archidekt's `non_field_errors` and `detail` (at most three, then "N more"), or else its
  reply quoted on one line and capped; an HTML error page leaves the status alone. "Card not
  found on Archidekt: …" and the card search's failure are keyed too, and name the card as
  the sync's own lines do (printing, finish and language included). A `build-site` skip
  line for an Archidekt deck URL reads the same sentence in the UI language.
  - **Keys:** the sync reports carry them — each item's `reasonKey` / `reasonParams`, a
    collection run's `errorMessages` — on the CLI's `--output json`, the admin API and the
    MCP `sync_decks` / `sync_collection` results, as `domain.sync.archidekt.*` with `status`
    a number param and no reason phrase. `import-account --output json` now carries them
    too: per deck (`decks[].errorKey` / `errorParams`) and in its error envelope.
    `ritual import`'s envelope stays `cli.import.failed`, whose `reason` param is the
    Archidekt sentence in English.
  - **`POST /api/import-deck` answers an Archidekt failure by whose it was:** `404` when
    Archidekt has no such deck (or will not show a private one), `502` when it failed any
    other way (a 403, a 5xx, a rate limit, a reply that cannot be read); both were `500`. So
    the MCP `import_deck` tool now fails `code: "invalid-request"` for a missing or private
    Archidekt deck (it was `internal`).
  - The warning that a deck list was cut short (a next-page link Ritual will not follow, a
    page served twice, the 100-page cap) is worded in the reader's language. It is a
    run-log warning of `deck-sync push` only, and its data is in the reports (see Fixed).
- **`self-update` words its refusals in the CLI's language, reason included.** Why a
  GitHub release was refused ("GitHub sent an unexpected response for …: draft is not a
  boolean"), why its `.sha256` file could not be read, why the downloaded binary failed its
  `--version` check, a disk that filled up mid-install, and a `--tag` that is not a release
  now read in the UI language, the reason nested in the sentence around it. Text quoted from
  GitHub or from the new binary (a tag, a file name in the checksum file, the binary's
  output) is put on one line, stripped of control characters and capped, and a binary that
  printed nothing says so ("it printed nothing", "exit 1, with no output"). A release field
  that is present but not text reads "tag_name is not a non-empty string" (it read "tag_name
  is missing"). The checksum file is read only up to 4 KiB.
- **A cache feed host's console follows its UI language.** Its refresh, publish, prune and
  seeding lines, and the reasons a refresh fails (a bulk download error, a manifest
  missing a bulk, a refused file name), are worded in the UI language behind the
  untranslated `[cache-feed]` prefix. `cache feed host` and `cache feed fetch` print every
  failure (a busy port, a failed first feed, a failed scheduled refresh or re-check, a
  failed seeding start or sync) as one line naming its cause, in place of a stack trace.
  **The `--verbose` request line is now `key=value` fields**,
  `[cache-feed] method=GET path=/feed.json status=200 durationMs=3` (it read
  `[cache-feed] GET /feed.json 200 3ms`): update any log filter that matched the old form.
- **`card` and `scry --random` keep their `--output json` params English.** A lookup that
  fails on a timed-out Scryfall request reports `cli.card.fetchFailed` /
  `cli.scry.randomFailed` with its `reason` param in English whatever the UI language (it
  followed it), and so do a `--set`/`--collector-number` pin that Scryfall could not verify
  (`cli.cardOps.verifyPrintingFailed`, `cli.cardOps.printingUnverified`: `reason` and
  `advice`) in `add-card`, `set-card` and `move`. Only `message` follows the UI language.
- **The Scryfall client's console lines follow the CLI's UI language**: card lookups, a
  card-cache or tag refresh (`cache preload-all`, `cache refresh-tags`, every refresh on
  demand), a cache feed ingest (`cache feed fetch`), and the same lines in the cache
  server's, the feed host's and the admin server's consoles. A refresh's lock file still
  names its operation in English (`bulk card cache download`), which another Ritual process
  reads. Counted lines now use the singular for one: "Processed 1 card.", "Skipped 1
  malformed bulk card entry.", "Filtered out 1 printing (…).", "Re-attaching tags to 1 cached
  card...", "Indexed tags for 1 oracle id and 1 illustration.", and the "Filtered out"
  breakdown counts tokens as "2 tokens" (it read "2 token"). A refresh's first and saving
  lines now end in an ellipsis, as on the admin page: "Fetching bulk data metadata from
  Scryfall…" and "Saving to cache…" (they ended in "..."). A tag file Scryfall refuses reads
  "Failed to fetch tag bulk <url>: <status> <reason>", as before.
- **Config refusals follow the reader's language, and carry their keys.** `config set`,
  `config get` and `config unset` word an invalid property or value in the CLI's language,
  and their `--output json` error envelope now carries `messageKey` (`cli.config.*`, or
  `domain.config.*` for a value the validator refuses) and `messageParams`, with any nested
  part flattened to English. A refused `priceSources` or `defaultPriceSource` value is
  keyed too (`domain.config.mustBeOneOf`, `domain.config.mustBeStringArray`, or the new
  `domain.config.unknownStore`); its printed message joins the list of stores in the
  CLI's language.
- **`sell`'s number filters name the flag they refuse.** `sell --min`, `--min-ratio` and
  `--min-owned` refuse a bad value as "Invalid --min-ratio 'half' (expected a
  non-negative number)" (it read "Invalid minimum ratio 'half' …"), in the CLI's language.
  `GET /api/sell/report` and `GET /api/sell/cart` answer a malformed `min`, `minRatio` or
  `minOwned` with `messageKey` `errors.number.notNonNegative` or
  `errors.number.notWholeNumber` and the parameter as the query spells it ("Invalid
  minOwned '1.5' (expected a whole number)"; it read "Invalid minimum owned count …", with
  no key). Update anything that matched the old text.
- **Theme errors follow the reader's language.** The theme editor's Import… refusals (a
  file that is not a theme, not JSON, or unreadable) are worded in the browser's language
  and relabelled when you switch it. A file that is not JSON reads "This file is not valid
  JSON (line 1, column 2)." (the position when the browser reports one) instead of
  repeating the browser's own English parser message, and a list sidecar (`.art.json`,
  `.categories.json`) that is not JSON is refused the same way; `build-site` and `serve`'s `--theme-file` and
  `--theme`, and `admin --theme`, word theme refusals in the CLI's, with the built-in theme names joined
  in it. So do the `--out-dir` refusals of `build-site` and `serve`, the `Price:` /
  `Cheapest printing:` line `add-card` and the edit sessions print after an add, and the
  site build's "Could not find printing" warnings. A built site's stylesheet is unchanged.
- **Card-line diagnostics, and the card vocabulary's refusals, carry their keys.** Why a
  card line could not be read, or how an export line was read, is now a message: English
  plus a `domain.card.line.*` key, located by `domain.card.line.inFile` (`{ file, line, text }`)
  or `domain.card.line.atLine` (`{ line, text }`) with the diagnostic nested as `text`, and a
  suggested fix nested beside it through `domain.card.line.withHint`. That reaches every
  import's `warnings`/`advisories` (`ritual import --output json`, `POST /api/import-deck`,
  MCP `import_deck`) and `ritual cleanup --output json`'s `warnings`, and the CLI prints it
  in its own language (`ritual import`, the `edit` sessions, `cleanup`, `detect-changes`). A label, tag, category, note, set-code or
  card-language refusal is keyed too (`domain.card.*`, `errors.label.*`, and
  `domain.config.defaultCategories*` for the `defaultCategories` setting): in
  `PUT /api/config`, the metadata, save, export, card-index, sell and buylist-quote routes'
  400 bodies, a CSV row's `reasonKey`/`reasonParams`, a change bundle's
  `domain.changes.problem.fieldRejected` (whose `detail` is now the rule's nested message
  instead of English text), and the admin Settings page and the editors' tag and category
  dialogs, which relabel the refusal when the reader switches language. A shape rule nests
  as `rule` (`domain.card.tag.shapeRule`, `domain.card.category.shapeRule`). The English is
  unchanged except: "labels do not apply to a wanted." now reads "labels do not apply to a
  wanted list.", "labels [x] are not supported on a wanted; …" reads "… on a wanted
  list; …", and `detect-changes` words a list's parse warnings in the CLI's language like
  its other warnings. A skipped import line's `domain.import.text.malformedLine` no longer
  carries an empty `hint` param; one carrying a misspelled language token (`[JA]`, `[jp]`) is
  `domain.import.text.malformedLineLanguage` with a `language` param instead — a script that
  finds skipped lines by key must now match both keys.
- **`detect-changes --output json` warnings carry their keys.** Each `warnings` entry keeps
  its `kind`, `file` and `revision` and its English `message`, and gains `messageKey` and
  `messageParams`: `cli.detectChanges.missingFile` (`{ path }`) or
  `cli.detectChanges.parseWarning` (`{ revision, path, commit, detail }`, the parser's own
  warning nested as `detail`). Its `message` is now English whatever the CLI's language (a
  `missing-file` entry's followed the CLI's language before); the text report prints it in
  the CLI's language.
- **List-load warnings are messages, not strings.** `GET /api/deck/:slug`,
  `/api/collection/:slug` and `/api/wanted/:slug` (every view) and the MCP `get_list` result
  carry each `warnings` entry as `{ "message", "messageKey", "messageParams" }` instead of a
  bare string; `message` is the English it always was. So does a sync's unreadable-lines
  report — `ritual deck-sync --output json` and `ritual collection-sync --output json`'s
  `unreadable[].warnings`, the MCP `sync_decks`/`sync_collection` `report.unreadable`, and
  the admin routes' `report.unreadable` and `unreadable-lines` stream frame — which the
  admin sync pages now show in the reader's language. A save, move or CSV append refused over such a file
  (`domain.list.unreadableContent`) nests each of those warnings as a keyed message in its
  `problems` param, instead of English text. Update any script that read these arrays as
  strings to read `.message`, and match on `messageKey`.
- **Export and diff warnings are messages, and export refusals carry their keys.** The
  `warnings` of `POST /api/export` (both modes), the MCP `export_cards` result,
  `ritual diff --output json`, `GET /api/diff` and the MCP `diff_lists` result are now
  `{ "message", "messageKey", "messageParams" }` objects instead of bare strings
  (`domain.export.warning.*`; a list's own parse warning nests as `warning` inside
  `domain.export.warning.inList`, and the sections a decklist dialect left out are a
  `unit` list of `domain.export.warning.sectionCount` messages, whose `section` is a
  `domain.board.*` message for a standard board such as `Maybeboard` and the heading as
  written otherwise). `message` is the English
  it always was. A refused `columns`, `filters.conditions` or `filters.labels` in
  `POST /api/export` is keyed (`domain.export.problem.*`, the accepted values a `unit`
  list), and so is a malformed `exportPresets` setting (in `PUT /api/config`, and in the
  warning the config loader prints), with a column list's own refusal nested as `reason`.
  `ritual export` and `ritual diff` print all of these in the CLI's language, and the
  export wizard's column picker shows the column labels in it too (`Variant` when the
  export is in the `archidekt` dialect); the CSV header cells an export writes stay
  English, byte for byte. A `collection-sync push` that builds its Archidekt CSV logs each
  card the local cache could not give a Scryfall ID in the CLI's language and on the admin
  Sync Collection page in the reader's, and its `log` frames carry
  `domain.export.warning.scryfallIdUncached` where they were keyless English. A server-written
  export that cannot find a free file name now answers `500` with
  `domain.export.problem.fileNameExhausted`. Update any script that read these `warnings`
  as strings to read `.message`, and match on `messageKey`.
- `ritual set-card --language` and `add-card --language` word an unknown language in the
  CLI's language.
- **A refusal before the command runs honours `--output json`.** A `--base-dir` /
  `RITUAL_BASE_DIR` that is not a directory (`cli.baseDir.*`, exit 2) and a
  `ritual.config.json` that is not JSON (`domain.config.fileNotJson`, exit 1) — like
  anything else the start-up checks refuse — were printed as plain text even under
  `--output json`/`ndjson`; they now go to stderr as the standard error envelope, with
  their key and English params. Text output is unchanged, and so is a command's own
  non-scripting format (`scry`/`sell --output csv` still report them as text). `card`
  defaults to `--output json`, so its start-up refusals are now envelopes even with no
  `--output` flag. Both are worded in the CLI's
  language; a config file that does not parse cannot name its own `uiLocale`, so that
  refusal is in the language `--locale`, `RITUAL_LOCALE` or the OS chose.
- The config loader's "ignoring invalid …" warning and `migrate`'s "would still be invalid"
  refusal are printed in the CLI's language (both are console text, with no envelope).
  `migrate`'s refusal no longer repeats a block's name: it reads `managed config:
"migration" must be a non-negative integer` (it read `managed config: managed config: …`)
  and `admin config must be a JSON object` (it read `admin config: admin config must be a
JSON object`).
- **`PUT /api/config` refuses a value in English plus its key.** A malformed value now
  answers with `messageKey` and `messageParams` beside the English `message` (it sent the
  English alone), where a block's refusal (`domain.config.inSection`) nests the field's as
  its `reason` and a list of accepted values is a `{ list, join }`; the admin Settings page
  shows it in the reader's language. The MCP
  `update_config` tool keeps answering with the English. A config file broken by hand
  under a running admin server answers every request with the same English plus
  `domain.config.fileNotJson`.
- `ritual locale --output json` adds `errorKey` and `errorParams` beside each `ignored`
  entry's English `error`. Apart from the `migrate` refusal above, the English of every
  config message is unchanged, and `ritual.config.json` is written byte for byte the same
  in every UI language.
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
- **Import warnings, advisories and row failures are messages, not strings.** In
  `POST /api/import-csv` and `POST /api/import-deck` (and the MCP `import_csv` and
  `import_deck` results), `ritual import --output json` and
  `ritual import-account --output json`, each entry of `warnings` and `advisories` is now
  `{ "message", "messageKey", "messageParams" }` instead of a bare string; `message` is the
  English it always was. A text import's warning whose card was imported without its
  labels carries `labelsDropped: true`, so a client can tell it from a skipped line. Each
  CSV `failures` entry keeps its English `reason` and gains `reasonKey` and
  `reasonParams`; a row failing for several reasons nests them as a list. Update any
  script that read these arrays as strings to read `.message`, and match on `messageKey`
  where it is present.
- In a `collection-sync` report (`--output json`, the admin `POST /api/collection-sync`
  response and the MCP `sync_collection` result), the `domain.sync.recordSkipped` warning's
  `reason` param and the `domain.sync.csvChunkUnreadable` log line's `error` param are now
  nested message objects (`{ "messageKey", "messageParams" }`) instead of English strings.
  The English `message` beside them is unchanged; a script that read those params as
  strings should render the key or read `message` instead.
- `ritual import-account --output json` reports a deck's `error` in English, with
  `errorKey`/`errorParams` beside it, whatever the CLI's language (it followed the CLI's
  language before).
- Import text follows the UI language. `ritual import` prints its CSV refusals, row
  reasons, skipped lines, URL-import progress and deck-service failures in yours, and the
  admin Import CSV page shows its column labels, a pasted file's parse and mapping problems,
  the row reasons and the warnings in the browser's, relabelling them when you switch. The
  import routes' refusals (an unparseable CSV, a bad column spec, a column the file does
  not have, an unsupported URL, a missing Moxfield user agent, a list that already exists)
  and a deck service's error replies now carry `messageKey`; the API, MCP and JSON output
  stay English.
- CSV imports can recognize column headings in other languages, once a translation lists
  them. The `ritual import` wizard and the admin Import CSV page recognize the English
  headings plus the spellings of the interface language; the admin API's header-row check
  recognizes the English headings plus those of every language the build ships, so its
  `warnings` do not depend on the server's language. Column guesses take English headings
  first and let a translation's spellings fill only fields still unpicked, so every English
  heading keeps its English field in every language.
- Some import wording counts its nouns properly: "the file has 6 columns" (it read
  `column(s)`), "2 lines could not be imported:", "1 line was imported without its
  labels:", "1 row failed to import:", "Imported 3 cards into collection 'Binder': …" and
  the matching `[dry-run]` lines, "Dropped categories for cards no longer in the list: …",
  "Categories are recorded for a card the list does not hold: …", and "Cannot import as a
  collection: 1 card line has no printing …". Update any script that matched `card(s)`,
  `column(s)`, `line(s)` or `row(s)` in import output.
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
- List-file messages follow the UI language. The CLI prints in yours the refusals of
  `new`, `rename` and `delete` (a name that collides with another list, has no usable
  file-name characters, or a confirmation that does not match), an unknown deck format, a
  custom-art reference, cover image or description that is not usable, a metadata or cover
  write over front matter it cannot read, a save or move that would delete content the
  parser cannot write back, and an unreadable `.art.json` or `.categories.json`. The admin
  site shows these refusals, a custom-art or cover reference it refuses as you type, and a
  staged custom-art write that failed on save, in the browser's language and relabels them
  when you switch. List files, their front matter and sidecars, the changelog's move lines
  and the admin server's commit messages stay English.
- **More `--output json` error envelopes carry a `messageKey`.** The refusals of `new`,
  `rename`, `delete`, `import` (a list name with no usable file-name characters, an unknown
  `--deck-format`, a URL import with `--type collection` or `wanted`), `add-card` creating a
  list, `metadata set`, `metadata get` and `set-list-image` now carry `messageKey` and
  English-flattened `messageParams`; their `message` follows the CLI's language. Scripts
  should match on `messageKey`, not on `message`.
- **`cleanup --output json` warnings are messages, not strings.** Each entry of a file's
  `warnings` is now `{ "message", "messageKey", "messageParams" }`, and the payload's
  flattened `warnings` are the same objects with a `file` field, instead of
  `"<file>: <warning>"` strings. `message` is English whatever the CLI's language (it
  followed the CLI's language before); the key is absent for a card line the grammar
  refused. Update any script that read these as strings to read `.message` and `.file`, and
  match on `messageKey`.
- **More admin API refusals carry a `messageKey`.** The create, rename and delete routes,
  `PUT /api/metadata/:type/:slug`, `PUT /api/art/:type/:slug`, the list save routes'
  unreadable-content refusal and their cross-list moves' refusals (a list that is gone,
  holds no copy to take, or cannot be staged), and these Import CSV refusals: a new list
  name with no usable characters, an append to an unreadable file, and an unknown `format`.
  So does the categories-file error among an import's warnings (`POST /api/import-csv`,
  `POST /api/import-deck`, the MCP `import_csv` and `import_deck` results,
  `ritual import --output json`). They now answer in English plus
  `messageKey`/`messageParams` (`domain.list.*`), where they were unkeyed English. An
  Import CSV whose new list name collides nests the collision as its `reason` param, and a
  text import's ignored `image:` its reason. Some params nest: the keys a cover or art
  reference does not accept and an unknown format's valid `formats` are a
  `{ list, join: "unit" }`, an unreadable `.art.json`'s `reason` is the parse problem as a
  message, and the unreadable-content refusal's `problems` is a `{ list, join: "clauses" }`
  holding the parser's warnings and, for a fenced code block, a nested message. A deck
  sync's categories-file failure nests its reason the same way. The English is unchanged;
  MCP tool errors keep `{ error, code, message }`. Match on `messageKey`.
- A list-resolution refusal's remedy (`errors.resolveList.adviceTypePrefix`,
  `errors.resolveList.adviceTypeField`) words its "or" in the reader's language: when two
  or more alternatives are offered, its `prefixes` / `types` param is a nested
  `errors.resolveList.alternative` message (`{ messageKey, messageParams }`) instead of a
  pre-joined English string. The English is unchanged; a script reading those params as
  strings should render the key or read `message`.
- The fenced-code-block entry of an unreadable-file warning or refusal counts its lines
  properly: "Fenced code block content (1 line) — …" and "(3 lines)" (it read `line(s)`). A
  collection or wanted list read by a collection sync reports a front-matter problem (an
  unreadable block, an unusable `labels:`) on the run log keyed, and an internal engine
  error a list operation raises answers the admin API in English with its key. Update any
  script that matched `line(s)`.
- The group headings on list pages follow the site's language on the public and admin
  sites, and relabel when you switch: the color identity names (a guild, shard or wedge
  keeps its mana letters, as in `Azorius (WU)` and `WUBG (Four Color)`), the card types
  under **Group by Type** (**Creature**, **Land**, **Other**, …), **Specific Printing** /
  **Any Printing**, **On Buylist** / **Not on Buylist**, **No Price Data** and **All
  Cards**. So do the color filter's swatch names, the "Buylist prices are unavailable"
  notice and a page's "Failed to load data." message. Shared links are unchanged: they
  store only the grouping (`group=color-identity`), never a heading. Switching language
  no longer rebuilds the cards on screen, so a flipped double-faced card stays flipped.
- Price-bracket headings show their bounds as prices in your language, the way every
  other price on the page does: `$0.50 – $1.00` and `$100.00+` (they read `$0.50 – $1`
  and `$100+`), and `0,50 € – 1,00 €` in German.
- **A card section's `data-section` attribute and heading anchor are now a code, not the
  heading.** `data-section` reads `type:creature`, `color:WU`, `printing:any`,
  `price:0.5`, `buylist-price:none`, `tags:ramp, staple`, `category:ramp` (folded to
  lowercase), `source:deck:my-deck` (the list's type and slug), `board:Sideboard` or
  `board:Main/category:ramp`, the same in every language, where it used to carry the
  heading text. The anchor id is built from that code (`section-color_3a_WU`). Update a
  custom stylesheet or script that selected a section by its heading.
- The public and admin sites word the rest of their text in the site's language: the
  numeric filters' refusals under **Mana Value**, **Price**, **Buylist** and **Copies**
  (an error already on screen relabels when you switch language, and the value you typed
  stays put), a card tile's copy-count badge (`3x`), the footer's Scryfall credit link,
  the **Cache** / **Scryfall** tag on a trade row for a card in none of your lists, and
  the browser-console lines logged when a list, the site index or a card search fails to
  load. A combined view's "Combining:" line separates its list names the way your
  language writes a list.
- **The Card Kingdom buylist's refusals and warnings are keyed.** A buylist route with no
  feed downloaded (`GET /api/buylist/status`, `POST /api/buylist/quotes`, the sell report and
  cart, `GET /api/price/*?source=cardkingdom`) answers its `503` in English with
  `messageKey` `domain.cache.cardKingdom.missingApiAdvice`, whose `lead` param nests the
  shared `domain.cache.cardKingdom.noFeed` sentence and whose `tool`, `route` and `command`
  params are the identifiers it names (`refresh_buylist`, `POST /api/sell/refresh`,
  `ritual sell --refresh auto`). A failed feed download (`domain.cache.cardKingdom.downloadFailed`,
  `downloadHttpFailed`, `notJson`) or a feed that does not parse
  (`domain.cache.cardKingdom.feed.*`) is keyed on `POST /api/sell/refresh`'s `502` the same
  way. The admin Refresh Cache page's buylist card shows these, its outcome line and a failed
  status read in the browser's language, and relabels them when you switch.
- **`POST /api/sell/refresh` and MCP `refresh_buylist` drop `warnings` for `staleFallback`
  and `skippedRows`.** A failed download that fell back to the stale cached feed is now
  `staleFallback`, a message (English `message`, `messageKey`, `messageParams`) present only
  then, where it was the one string in `warnings`; `refreshed: false` without it means the feed
  was still fresh. The new `skippedRows` lists the downloaded feed's malformed product rows as
  messages — the first ten itemized (`domain.cache.cardKingdom.feed.productSkipped`, the row's
  reason nested as `reason`), then a count — which used to reach only the server's console.
  Update a client that read `warnings`: check `staleFallback`, read its `.message` for the
  English, and match on `messageKey`.
- `ritual sell` and `ritual price --source cardkingdom` word a missing buylist in the CLI's
  language, and their `--output json` envelope carries `messageKey`
  `domain.cache.cardKingdom.missingAdvice` with English params (`lead`, `flag`, `size`); the
  envelope's `message` follows the CLI's language. The interactive price browser's refusal
  when you switch to Card Kingdom, `build-site`'s "buylist is unavailable" reason, `cache
preload-all`'s buylist-failure warning, the buylist's download prompt and progress lines,
  the stale-feed fallback warning (now "Using the buylist retrieved 2 days ago instead: …",
  the failure last), the servers' "Sell mode: …" startup warning and the "Ignoring unreadable
  Card Kingdom cache" warnings follow the CLI's language too. A feed row skipped while
  parsing is printed in the CLI's language with its reason nested (such as "missing card
  name"), and now also appears in `skippedRows`; an unreadable value it quotes is shown as
  JSON, capped at 80 characters. Counts read "1 product" (they read "1 products"). The
  `cache/cardkingdom.json` file is unchanged.
- More CLI text follows the UI language: `detect-changes`'s `--hash-only` and `--verify`
  per-file lines (`[dry-run] decks/a.md: <hash>`) and its git failure lines (git's own detail
  still follows `git:` as git wrote it), the `--no-input` refusals that name a list, a card or
  a pair of flags, `ritual admin`'s startup build failures, shutdown warnings and page title,
  `init-site`'s ".gitignore still ignores" warning, and the internal "no case handles this
  value" error. `export` lists conflicting flags the way the UI language lists things
  ("--columns, --no-header, and --quote-all"; it read "--columns and --no-header and
  --quote-all"). `ritual admin`'s shutdown warnings now read "MCP HTTP server teardown
  failed:" and "Admin server teardown failed:". The README that `init-site` generates stays
  English, whatever the UI language: it is workspace content.
- **A refused fixed-choice value names the flag you typed.** "Invalid … '<value>'. Use one
  of: …" now names the flag or argument instead of a noun, so it reads the same in every
  language: `Invalid --only 'adds'` (was `Invalid change filter`), `Invalid <direction>`
  (`deck-sync` / `collection-sync`; was `Invalid direction`), `Invalid --format`, `--finish`
  and `--dialect` (`export`; were `export format`, `finish`, `dialect`), `Invalid --sort`
  (`price`; was `sort field`), `Invalid --source` / `--price-source` / `--price-sources`
  (`price`, `init-site`, `build-site`; was `price store`), `Invalid --ci` and `--deploy`
  (`init-site`; were `CI system`, `deploy mode`), `Invalid --finish` and `--label`
  (`add-card`, `set-card`, `move`; were `finish`, `label`), `Invalid --output` (was `output format`)
  and `Invalid --refresh` (was `refresh mode`). A script matching the old wording must match
  the new one, or better the `errors.enum.invalid` key. The admin API's refusals still name
  the request field (`direction`, `format`).
- **`--no-input` refusals keep their `--output json` params English.** The
  `errors.input.required` envelope's `messageParams` (`subject`, `reason`) are now English
  whatever the UI language (they followed it); only `message` follows the UI language. Two
  refusals reworded: `delete` now asks to "pass --confirm <name>" (it read `pass --confirm
"<list name>"`), and `init-site` to "pass --change-detection or --no-change-detection" (it
  read `--change-detection/--no-change-detection`).
- **`detect-changes` git failures carry their keys.** With `--output json`, a failed git
  command's error envelope now carries `messageKey` (`cli.detectChanges.gitDetail`, the
  failed operation's own `cli.detectChanges.*` key, or `cli.detectChanges.failureReason`)
  and English `messageParams`, with git's detail verbatim; the English `message` is
  unchanged.
- **The card, buylist and art routes' refusals are keyed.** `/api/card-details`,
  `/api/card-price`, `/api/card-prices`, `/api/card-printings`, `/api/card-search`,
  `/api/cards`, `/api/buylist/*` and `/art/*`, on the admin server and on `serve --api`
  alike, and every route's malformed-body refusals (not JSON, not an object, `413` too
  large), now carry `messageKey` and `messageParams` beside the English `message`. A bad
  field is one shared family, `admin.api.field.*`, whose `field` param is the field as the
  request spelled it (`printings[3].set`); the body refusals are `admin.api.body.*`, the
  `413`'s limit in exact bytes as `count`. Several admin routes' "X is required" refusals
  (`/api/import-csv`'s `name`, `/api/import-deck`'s `url` and `content`, the TOTP
  `code`, a delete's `confirmName`, `/api/export`'s `filters` object, and the admin
  sign-in, Archidekt and first-run forms' `username`/`password`) moved onto the same family. The
  buylist gate's and the admin server's `404` share `admin.api.server.notFound`. On
  `serve --api`, every JSON `404` (unknown `/api/*` path, list, locale dictionary or art
  file) and the last-resort `500` keep their `error` field with `errorKey` beside it.
  Sentences are reworded to fit the family; update any script that matched them, or match
  on `messageKey`:
  - Field names are now double-quoted and each sentence ends with a period, for example
    `"printings" must be an array.` (was `"printings" must be an array`),
    `"printings[0].set" must be a non-empty string.`, `"names" must be an array of
strings.`, `"names" must contain at most 500 entries.`, `"ids" is required.` (was
    `ids is required`), `"ids" must contain at least one Scryfall ID.`,
    `"ids" must contain at most 200 entries.`, `"name" is required.`, `"q" is required.`,
    `"url" is required.`, `"content" is required.`, `"code" is required.`,
    `"confirmName" is required.`, `"filters" must be an object.` and
    `"username" and "password" are required.` (the admin sign-in route's was `Username and
password are required`). Every route's existing boolean and string
    checks read the same way: `"dryRun" must be a boolean.` (was `dryRun must be a
boolean.`), `"contentHash" must be a string.`.
  - `"printings[0].scryfallId" must be a string.` (was `… must be a string when present`).
  - `"limit" must be at most 175 (one Scryfall page), got '176'.` (`limit` was unquoted).
  - `No printings found for 'Sol Ring'.` gained its period.
  - An invalid `limit`, `page` or `offset` reads `Invalid "limit" 'abc'. Use a positive
integer.` / `Invalid "offset" '-1'. Use a non-negative integer.` on every route that
    takes one, the list load routes included (was `Invalid limit 'abc'.`; `/api/card-search`'s
    `page` read `page must be a positive integer, got '0'.`). The value it names is the one
    sent with surrounding spaces removed.
  - An unknown `buyer` or `finish` reads `Invalid buyer 'x'. Use one of: cardkingdom.`
    (was `"buyer" must be one of: cardkingdom`), and a missing finish
    `printings[0].finish must be one of: nonfoil, foil, etched.`.
  - The admin server's `404` for a path with no route reads `Not found` (was `Not Found`).
- **`POST /api/buylist/quotes` reads its body more leniently.** `buyer`, each printing's
  `finish` and its `language` are matched case-insensitively, as `--finish` is on the
  CLI, so `"finish": "FOIL"` and `"language": "JA"` are accepted; the response's quote keys
  still use the canonical lowercase finish (`dsk:136:foil`). `set` and `collectorNumber`
  are trimmed, so a whitespace-only value is refused as blank. This is the HTTP route's
  rule: the MCP `get_buylist_quotes` tool's schema still takes lowercase values.
- **The sell cart's `warnings` are messages.** `GET /api/sell/cart` and MCP `get_sell_cart`
  now answer each warning (etched foils exported as foil, CK's 500-title and 5,000-card upload
  caps) as English `message` plus `messageKey` (`domain.buylist.cart.etchedAsFoil`,
  `tooManyTitles`, `tooManyCards`) and `messageParams`, where each was a bare string; the
  English is unchanged. Update a client that read `warnings[i]` as text: read its `.message`,
  and match on `messageKey`. `ritual sell --output csv` prints them in the CLI's language, and
  the public site's cart export and both sites' "Copy cart" warnings follow the site's
  language, relabelling one already on screen when you switch, and clear when you copy
  something else, close the Selected Cards dialog or turn sell mode off. The CSV itself is unchanged in every
  language.
- More text follows the UI language: the list editors' "Invalid Date" stand-in for an
  unreadable date, the browser-console warning for unreadable stored add-card defaults (it
  read `[editor-defaults] Failed to parse stored editor defaults: …`), and a few internal
  errors (an embedded asset that is not text, an empty trash request, a swap plan missing
  its chosen printing). The add-card dialog's finish and condition choices show their names
  (Foil, Near Mint; they read `foil`, `NM`), and its "not available in your language" notice
  names languages in the UI language, as do `ritual edit`'s language-fallback prompt and the
  trade picker's notice. Key names in the editors' hints and the shortcuts reference (Enter,
  Ctrl, Esc, Tab) stay English.
- **A malformed UI locale's reason follows the UI language too.** A refusal of the
  `uiLocale` setting, `--locale` or `RITUAL_LOCALE` (`invalid UI locale: invalid locale tag:
de_DE`) now nests the tag parser's reason as a message of its own: in the admin
  `PUT /api/config` refusal's `messageParams.reason` and in `ritual locale --output json`'s
  `ignored[].errorParams.reason`, it is
  `{ "messageKey": "errors.i18n.localeTag.invalid", "messageParams": { "value": "de_DE" } }`
  (or `…localeTag.notAString` / `…localeTag.empty`) where it was an English string — **a
  script reading `errorParams.reason` as text must read its `messageKey` instead** — and the
  CLI and the admin Settings page word the whole sentence in your language instead of
  splicing English into it. The English `message`, and the flattened English `reason` in a
  `--output json` error envelope, are unchanged. `build-site --locale-file` words a malformed file name or
  entry in your language the same way.
- `ritual serve` and `ritual mcp` follow the UI language on the console: the MCP server's
  "listening at" line and its transport errors, and both servers' unhandled-error lines.
  `ritual serve`'s plain-text `Not Found` and `Internal Server Error` pages are worded in the
  server's UI language. The MCP HTTP endpoint's own refusals (an unknown path, a missing
  or wrong token, an internal error) stay English and now carry their key in the JSON-RPC
  `error.data` (`{ "messageKey": "cli.mcp.endpointNotFound", "messageParams": { "path":
"/mcp" } }`).
- **The MCP `sync_collection` question about an ambiguous removal is in the UI language.**
  The form a client shows its user to choose which lists give up a card's copies was always
  English; it now follows the server's UI language (`--locale`, `RITUAL_LOCALE`, `uiLocale`),
  list join included. Tool descriptions, result guidance and errors addressed to the agent
  stay English.
- **Interactive prompts and `--help` speak the CLI's language throughout.** Every select
  prompt's "Use the arrow keys. Return to submit." hint, the "This option is disabled" note,
  a yes/no question's `(Y/n)` / `(y/N)` and its `yes` / `no` answer, a text prompt's
  fallback "Please enter a valid value" error, and the key list under `import-account`'s
  deck picker now follow the UI language (the key names, `Return`, `↑/↓`, `[space]` and the
  `y`/`n` letters, stay as they are). That deck picker's own "Space to toggle" hint is gone:
  the key list says the same. The prompts in `history`'s interactive editor and the
  `dep-license` picker follow the UI language too, and their searches now clear typed text on
  a first Esc, like every other search. On `--help` pages, the `(choices: …, default: …)`
  note after an option is worded in the UI language, its values unchanged and listed the
  way the language lists them, and so is `mcp --transport`'s "Allowed choices are stdio,
  http." refusal. Two English strings are reworded: the select hint now reads "Use the arrow
  keys." (it read "Use arrow-keys."), and the text-prompt error "Please enter a valid value"
  (it read "Please Enter A Valid Value").
- **A malformed `--locale` no longer hides `RITUAL_LOCALE`.** `--locale` is still refused with
  exit `2`, but the refusal is now worded in the language the remaining tiers pick
  (`RITUAL_LOCALE`, then `uiLocale`, then the OS) instead of skipping past a valid
  `RITUAL_LOCALE`. On Windows and macOS, a malformed `--locale` or `RITUAL_LOCALE` no
  longer stops Ritual from asking the OS for its language.
- **`build-site` and `serve --build` report a failed build the same way.** A failure such
  as Scryfall being unreachable now reads "Build failed: getaddrinfo ENOTFOUND
  api.scryfall.com" in the UI language under `build-site` (it printed the bare system
  text), and the previously published site is left in place. Under `serve --build`, a
  refusal from the build (a usage error such as a bad `--decks` name) now keeps its own
  message and exit code `2`, instead of being reported as "Build failed: …" with exit `1`.
- **Counted lines agree with their count.** "1 unsaved change" / "2 unsaved changes" in the
  `edit` list picker, "decks/a.md: 1 change" in `detect-changes`, `history`'s "Saved 1
  change set" and its hand-written-lines warning, `cleanup`'s folded-name and
  pruned-category lines, and the `edit` session's "discard this deck's 1 card change first"
  / "discard the 2 pending moves …" refusals (each read "change(s)" and the like).
  So do `history`'s "Rewrote history as a single change set with 1 entry" (it read
  "entr(y/ies)").
  `cleanup`'s `[check]` marker and the price browser's "lowest $2.00" note follow the UI
  language too. The help for `config set` and `metadata set` reads "One or more values to
  set" and "Add values to / Remove values from an array property", and `cache feed host
--cards` reads "Which card bulks to publish" (each read "value(s)" or "bulk(s)").
- **Card labels, deck boards and list types are named in your UI language wherever they are
  shown.** Your files, `.changes.md`, flags, URLs and the machine fields of `--output json`
  and API payloads keep the English tokens, and flags and filters still take them; a
  message's params name a standard board as a `domain.board.*` message, so a client words
  it in its own language.
  - Labels: the badges on card tiles (`sale`, `trade`, `keep`, `proxy`, a struck-through
    negation too), the `edit` session's Edit List Labels row and its "Default labels set to
    For sale, For trade." confirmation (it read `[sale,trade]`), and `set-card`'s
    `label → For sale, For trade` entry (it read `label → sale, trade`).
  - The four standard deck boards (Commander, Main, Sideboard, Maybeboard, matched
    case-insensitively, so a hand-written `## sideboard` is the Sideboard) in both sites'
    deck headings, section pickers and Sections manager, and in the CLI: the `edit`
    session's section pickers, card rows and "Added … to Sideboard" lines, `add-card`,
    `set-card`, the price browser, the export wizard, the export's omitted-sections warning,
    change descriptions, and `deck-sync`'s per-card lines and board-move warnings. Any other
    section is shown exactly as written; where two headings are the same board (`## Sideboard`
    beside `## sideboard`), pickers show both as written. Typing a board's name in your
    language as a new section name (the `edit` and `move` prompts, both sites' Sections
    manager and "New section…") names that board, so no translated heading reaches the file.
    A `--section` flag takes the English token only, and a case variant of it now creates
    the board under its own heading (`--section sideboard` writes `## Sideboard`; it wrote
    `## sideboard`). `move`'s new-section prompt no longer refuses a name starting with `#`,
    which the deck file reads back as written.
  - `ritual lists` words its type column in the UI language: `wanted list` (it read
    `wanted`). **Read the type from `lists --output json` in scripts**, where it is still
    `deck`, `collection` or `wanted`. A shared trade link's warnings name the list type the
    same way.
- **Language names, rarities, finishes and conditions follow the UI language too.** A card
  language is named the way your language names it (the Set Language picker, the admin
  Settings Default Language list, the collection card details, `edit`'s Card Language row,
  `set-card`'s applied change and its language checks). The printing
  picker's rarity reads `[Common]` (it read `[common]`). A change description's finish
  (`Set Sol Ring finish to foil`), `set-card`'s `finish → Foil` entry (it read `finish →
foil`), `move`'s "matching finish Foil" refusal and a `--finish` pin's "is not available in
  Foil" refusal name the finish in your language; the finishes such a refusal offers stay the
  `--finish` values you type. The collection card details name
  a condition (`Lightly Played`) instead of printing its code.
- **`cache status` and `history` dates read as dates.** `cache status` prints `yes`/`no`
  for its flags (it printed `true`/`false`), `local` or `cache server` for its source (it
  printed `cache-server`), its counts grouped and the last refresh as a local date and
  time, all in the UI language. `history --show` and the interactive history head each set
  with a local date and time. Both commands' `--output json` keep the raw values and the
  ISO-8601 timestamps.
- **Lists of things are joined the way your language joins them.** This covers `set-card`'s
  applied changes, `cleanup`'s per-file actions, the export wizard's columns, the `edit`
  list picker's badges, `import-changes`'s skipped-change tally, `diff`'s per-printing
  breakdown, the sell-mode shortfall note, the editors' save notices, the Move Cards
  banner, a trade link's unknown card IDs, and a card's labels in the site's card details
  (`For sale, For trade`; they were joined with `·`). The parentheses and separators around a counted note (a deck cover's
  `(99 cards)`, the edit banner's change count) are part of the translation too. The price
  browser's list row reads "1 card" for one card (it read "1 cards").
- **Translations can no longer alter a flag, a command or a file name.** Every machine token
  a message tells you to type or match — a flag (`--dry-run`, `--refresh auto`), a command
  line (`ritual migrate`, `ritual config set artDir <dir>`), an environment variable
  (`RITUAL_NO_INPUT`), a config key (`defaultLanguage`), a file or directory name
  (`ritual.config.json`, `.claude/skills`), an example URL or the CSV importer's example
  spellings — now reaches the text as a `{placeholder}` param instead of being written into
  the English catalog, so a translator can move it but not reword it. The English output is
  unchanged. Option values (`'daily'`, `'scryfall'`), admin API field names and MCP tool
  names still stay in the text. For translators: such a key's description names each
  placeholder and the exact token it holds, and a translation must keep every placeholder
  (`check-locales` already refuses one that drops it). Any keyed message in a JSON payload,
  admin API body or MCP result now carries those tokens in its `messageParams` too
  (`"flag": "--yes"`).
- **`check-locales` refuses an English message that inlines a machine token** (check 13,
  `inline-token`): a `--flag`, a `ritual <command>` line or a bare one (`config set`), an
  environment variable, or a file name, link or example value `src/util/cli-tokens.ts`
  spells, written into the text, is an error; pass it as a param from that module instead.
- **`set-card --output json`'s `applied` entries are messages.** Each is now an object
  (`message` in English, `messageKey`, `messageParams`, a finish, label, language or standard
  board nested as a message) instead of a bare string, and the section entry names the heading
  the card landed under (`section → Sideboard` for `--section sideboard`). **Update any
  script that read `applied` as strings to read `.message`, and match on `messageKey`.**
- **`history`'s set picker finds a set by its ISO timestamp too.** The rows show each set's
  local date and time, and typing an ISO-8601 fragment (`2026-05-29`) still finds the set.
- **Running or building Ritual from source needs Bun 1.4.4** (`.bun-version`); update Bun
  before your next `bun install`. Contributors format with `bun fmt` and type-check with
  `bun check` (`bun run format`, `bun run test` and `bun run verify` use them), and Prettier
  is no longer a dependency. The release binaries are unaffected.

### Fixed

- New cards now get the id the card-id rules promise, and the changelog records the id
  the line actually got.
  - A card added through the MCP server (or any client of the admin save API) was written
    with an id but logged in the changelog without one.
  - A card added after a removal in the same `import-changes` bundle, or in the same
    change file loaded into an editor, drew a new, higher id instead of reusing the one
    the removal freed.
  - A deck copy that merged onto a line the deck already had, whether added from the
    editors' Add Card search or imported, used up an id no line ever got.
  - A collection or wanted-list add sent to the admin save API with an id another line
    already held was logged under that id, while the file gave the new line a different one.

  Undoing an added copy whose line is still in the deck (a `+` click, or an add that
  merged), or undoing an add that had cancelled a decrement, no longer frees that line's
  id for the next card added in the session, which could give two lines the same id.
  Existing changelog entries are left as they are.

- Custom art picked in the admin editors' Add Card dialog is undone exactly. Undo puts
  back the art the undone add changed and nothing else: undoing a removal no longer
  drops art another pending add had picked for that card, and undoing an add that merged
  into an existing deck line now takes back the art it set there. Adding several copies of
  a deck card you had just removed no longer clears the card's existing custom art, and
  adding a copy that cancels a pending decrement keeps art already picked for that line.
  Art you set from a card's Custom Art dialog after adding a copy is kept: neither undoing
  that add nor the next save puts the add's art back over it. Undo is unavailable while a
  save is in progress.

- On the sites' card-image views, a card's count badge (`2x`, `4x`) sits below the selection
  checkbox instead of beside it, so it no longer covers the start of the card's name. Stack
  view keeps it beside the checkbox, since only the top strip of each card shows there.

- `build-site`'s `- Loaded <list> (N cards, …)` line shows the list's total at the site's
  default store, in that store's currency (`€12.50` for Cardmarket). It always printed the
  TCGplayer figure with a `$`.
- Opening the public site or the admin site with a language already pinned (the
  `__ritualLocale__` test seam, or any start that names the language before its dictionary
  has loaded) no longer leaves the header, navigation and footer in English: text drawn
  before the dictionary arrived is redrawn in the language once it does.

- **The public site's header no longer overlaps itself when it runs out of room.** Above
  phone width, the price store, language, Edit and Theme controls now move behind the **⚙**
  button in a second row whenever the header can't fit them inline: on tablets, and on wider
  screens when a selection button or longer labels need the space. If it is tighter still,
  the quick switch shows its icon alone. The logo and nav links stay in the header, and
  phones look as before.
- Switching the language twice in quick succession on the public site or the admin site no
  longer lets the first language's dictionary, arriving last, overrule the second. The last
  switch wins, only it is remembered for the next visit, and a page closed while its boot
  language was still loading no longer applies English afterwards.
- **`deck-sync push` no longer calls a deck someone else's when Archidekt cut the list of
  decks you own short.** A deck missing from a list Archidekt stopped serving part way is now
  `skipped` with the reason `domain.sync.ownershipUnknown` ("could not tell whether you own
  Archidekt deck …"), not `domain.sync.notDeckOwner`. The report carries why the list is
  incomplete as **`ownedDecksIncomplete`** (a message) on the CLI's `--output json`, the
  admin `POST /api/deck-sync` response and the MCP `sync_decks` result.
  **`import-account --output json`** says the same as **`listIncomplete`** when the account's
  deck list was cut short, so `found` may be short; the exit code is unchanged.
- **One odd Archidekt reply no longer aborts a whole sync.** A card search that never
  reached Archidekt, or answered with something that is not a search result (not JSON, no
  `results`), used to throw out of `deck-sync push` and `collection-sync push` part way
  through, after remote writes, with no report; it now fails that card, and a single hit
  Ritual cannot read (a token without a collector number) is skipped rather than failing the
  search. Deck, collection-page and deck-list replies are checked only for what Ritual reads,
  so a reply missing one of those parts fails that request with a `…Unreadable` reason
  naming it (`domain.sync.archidekt.deckUnreadable`, nesting `replyNotObject`,
  `replyFieldInvalid` or `pageItemUnreadable`) instead of a `TypeError`, while a field
  nothing reads never fails one: a listed deck without a name is kept as `Archidekt Deck
<id>`, a collection page without an owner block is read, a category without a name (or a
  card's categories that are not a list) reads as none, and a write Archidekt accepted is
  never refused over its reply. A pull, and the timestamp read back after a push, check
  only what a pull reads, so a relation a push could not plan against cannot drop the
  divergence baseline.
- A run that fails for many cards at once no longer builds one enormous reason: a deck's or
  collection list's `reason` names at most five failures, then "N more" (each failure is
  still in the run log). A CSV import row's problems and a removal priority's unknown list
  names are still listed in full.

- `deck-sync` and `collection-sync` under `--output json` or `ndjson` no longer print
  "Token refreshed successfully." (now "Refreshed the Archidekt session.") on stdout ahead
  of the report when the run refreshed an expired Archidekt session, which left the output
  unparseable. Under `--quiet` the line is dropped. Any other log line the sync engines
  write goes to stderr under structured output, and an unexpected failure of either command
  is now reported as the `--output json` error envelope.

- A tag named `Untagged` or a category named `Uncategorized` no longer merges into the
  group of cards that have none when you group by tags or categories.
- In a combined view grouped by **Source List**, two lists that share a name (a deck and a
  collection both called "Red") are two groups rather than one.
- Grouping by section puts a section the list's own order does not name after the named
  ones, instead of first.
- A deck card with 1,000 or more copies was saved as `- 1234 Sol Ring`, which the next
  read took as one copy of a card named "1234 Sol Ring": a bare run of four or more digits
  is the start of a card name, as in `1996 World Champion`. Ritual now writes such a
  quantity with an `x` (`- 1234x Sol Ring`) and reads its count back. This covers deck
  files and every text export: `export --format text` in all four dialects, the deck
  page's download, and **Copy as Text**.

  A deck line still in the old shape, never re-saved since, is now **held**: it loads as
  one copy of "1234 Sol Ring" and is reported with both fixes wherever a deck's
  unreadable lines are reported (`cleanup`, `import`, `detect-changes`, the admin load
  route and MCP `get_list`), and Ritual no longer rewrites it for you:

  - every whole-file save of that deck refuses until you settle the line: the admin and
    hosted editors, the MCP write tools, `cleanup`, `move`, and `import --append`;
  - `deck-sync` pull and push fail that deck every time, even with `-y` or Sync anyway;
  - `ritual edit` won't open the deck: named on the command line it exits 1, and picked
    from the menu it is skipped;
  - a one-shot edit aimed at that line (`set-card`, `note`, a label or tag, or an
    `add-card` that would merge onto it) refuses. Removing it, moving it to another
    section, and every edit to the deck's other lines keep working and leave it as written.

  Settle it by editing the file: `- 1234x Sol Ring` for 1,234 copies, or
  `- 1 1234 Sol Ring` if that really is the card's name. `detect-changes` pairs lines by
  their `&N`, so settling `- 1234 Sol Ring &5` as `- 1234x Sol Ring &5` shows up in the
  changelog as copies of "Sol Ring" added (1,233 here) on that line; a line with no
  `&N`, or one whose `&N` changed, is recorded as a removal plus an addition instead.

  A line that has been re-saved since reads `- 1 1234 Sol Ring`, which can't be told
  apart from a card that is really named that way, so Ritual can't flag or repair it.
  **Check your decks by hand for card names that start with a number of four or more
  digits**, and rewrite any you find as `- 1234x Sol Ring`. Text exports and **Copy as
  Text** output made by an earlier version carry the same bare form (`1234 Sol Ring`):
  fix those to `1234x Sol Ring` before you import them again.

- A card line whose quantity is too large to store exactly (more than
  9,007,199,254,740,991 copies) is now refused with a message saying so, rather than
  being read as a rounded count. A CSV cell holding such a quantity is refused for its
  row (`too large to store exactly`) instead of aborting the import.
- An Archidekt deck entry with a quantity no deck can hold (negative, a fraction, or too
  large) is skipped with a warning instead of aborting the import. An entry with zero
  copies is left out of the imported deck, and deck sync still sees it, so a push that
  re-adds the card on that entry's board updates that entry instead of adding a second
  one.
- A CSV import cell reading `constructor` was taken for a valid condition or finish (and,
  in a deck's section or categories column, for a board) — the alias tables were plain
  objects, so the name answered with a function from their prototype instead of being
  refused. It is now refused as an unrecognized condition or finish, and kept as an
  ordinary section name. A language value of `constructor` or `__proto__` (a CSV cell,
  `--language`, `config set defaultLanguage`) is likewise refused instead of read as a
  language.
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
