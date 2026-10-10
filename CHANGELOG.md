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

### Changed

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
