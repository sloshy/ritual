import type { RitualSkill } from '../types'
import {
  csvImportSection,
  DIFF_BY_MODES,
  interactiveEditIntro,
  PRICE_CURRENCY_COMMENT,
  PRICE_SOURCE_COMMENT,
  priceIntro,
  REFRESH_SESSION,
  sessionSemantics,
  SYNC_CHANGE_FILTER,
  textImportSection,
  wrapProse,
} from './shared'

export const collectionsSkill: RitualSkill = {
  name: 'ritual-collections',
  description:
    'Manage, sync, price, and sell a Magic: The Gathering card collection with Ritual. Use when the user wants to add owned cards to a collection, browse or bulk-add cards interactively, import a collection from a CSV export or text file, sync a collection with Archidekt (pull or push), get the total value of a collection, or check what Card Kingdom’s buylist pays for their cards.',
  body: `# Managing collections with Ritual

Collections of owned cards live in \`collections/<name>.md\`. See the **ritual**
skill for the file format.

## One-shot edits (non-interactive — best for agents)

Use the one-shot commands (covered in full by the **ritual-edit** skill).
\`add-card\` works on collections, and — when the type is pinned with
\`--collection\` or a \`collection:\` prefix — creates the collection if it does
not exist yet (including in a workspace with no collections at all; the file is
created only once the add is certain to succeed):

\`\`\`bash
ritual add-card "Main Binder" "Sol Ring" --collection --set c21 --collector-number 263
ritual add-card "Main Binder" "Black Lotus" --collection --set lea --collector-number 232 -c LP
ritual remove-card "Main Binder" "Sol Ring" --collection             # one entry
ritual set-card "Main Binder" "Sol Ring" --collection --finish foil --condition LP
ritual set-card "Main Binder" "Sol Ring" --collection --condition NONE   # clear the grade
ritual note "Main Binder" "Black Lotus" --collection -n "graded"     # or --clear
ritual move "Sol Ring" --from "collection:Main Binder" --to deck:burn
\`\`\`

\`-f\` finish (nonfoil/foil/etched), \`-c\` condition (NM/LP/MP/HP/DMG, or \`NONE\` to
record no condition). Collections track specific physical printings, so pin one
with \`--set\` + \`--collector-number\` — a non-interactive add without a pin only
succeeds when the card has a single paper printing. Neither finish nor condition
is defaulted: a headless add always needs \`-c\`, and needs \`-f\` whenever the
pinned printing comes in more than one finish — otherwise it exits 2 naming the
missing flag rather than writing a half-specified line.

## Labels: for sale / for trade / to keep / proxy

Collection lists and cards carry **labels** declaring what the owner would do
with them: \`sale\` and \`trade\` (combinable), \`keep\`, or \`proxy\` — \`keep\` and
\`proxy\` are each exclusive of every other label, including each other. A
list-level default lives in the collection's front matter
(\`labels: [sale, trade]\`); an individual card overrides it with a bracketed
token on its line (\`[keep]\`, \`[sale,trade]\`). A card's *effective* labels are
its override when present, else the list default. Labels drive the public
site's list filters, the collections-index "Labels" view-all menu, and a
one-time warning when a \`keep\`-labeled card is added to a trade. Decks carry
\`proxy\` too, and nothing else (see the **ritual-decks** skill); wanted lists
carry no labels at all.

A \`proxy\`-labeled card is **not a real card**: it prices as **0** everywhere
(\`ritual price\`, the published site's totals, the card's own price) rather than
counting as an unpriced card, and it is left out of \`ritual sell\`, the buylist
quotes, and the sell cart entirely — a proxy missing from a sell report is the
rule, not a lookup failure. Pair it with custom art (see the **ritual** skill's
*Custom art* section) to show the proxy's own image; custom art carries the same
no-price rule by itself, with reason \`custom-art\` (which wins over \`proxy\`
when a card has both).

\`\`\`bash
ritual set-card "Main Binder" "Sol Ring" --collection --label keep       # override
ritual set-card "Main Binder" "Sol Ring" --collection --label sale,trade
ritual set-card "Main Binder" "Sol Ring" --collection --label proxy     # not a real card: no price
ritual set-card "Main Binder" "Sol Ring" --collection --label none      # back to the list default
ritual add-card "Main Binder" "Mox Jet" --collection --set lea --collector-number 262 -c LP --label keep
ritual export --collection --labels trade --columns name,set,collectorNumber,labels
\`\`\`

The list-level default is set with \`ritual metadata\` (the scripting surface —
mirrors \`ritual config\`'s set/get/list/unset shape), the interactive session's
\`🏷️ Edit List Labels\` action (written on the session's next save), the admin
editor's **Labels** button, hand-editing the front matter, or the MCP
\`set_list_metadata\` tool (\`labels\` on a collection; \`null\` clears it).

\`\`\`bash
ritual metadata set "Main Binder" labels sale,trade   # list default
ritual metadata get "Main Binder" labels
ritual metadata unset "Main Binder" labels            # no default
\`\`\`

## Tags: the owner's own vocabulary

Separate from labels, any card on any list type can carry **tags** — the owner's own
words for a card as a copy (\`Signed\`, \`Trade Binder\`), which follow the card
wherever it moves, written as one
comma-separated \`#\` token after the labels and before the note (\`- Sol Ring (C21:240)
[keep] #Binder Trade, Ramp &1\`), as many per card as wanted. A tag means whatever
its author meant (it drives filtering and grouping, never pricing or any other
behavior); it is plain text that keeps its spaces and case and cannot contain \`#\`,
\`,\`, \`&\`, brackets, braces or parentheses. The \`#\` is file punctuation only —
never part of a value, never shown by any UI. \`set-card --tag\` adds, \`--untag\`
removes, and \`add-card --tag\` tags a fresh add; several tags go **comma-separated**
(spaces are part of a tag). The interactive session's per-card \`🔖 Edit Tags\` action
edits the whole set in one field.

\`\`\`bash
ritual set-card "Main Binder" "Sol Ring" --collection --tag "Ramp, Staple"
ritual set-card "Main Binder" "Sol Ring" --collection --untag Ramp
ritual add-card "Main Binder" "Mox Jet" --collection --set lea --collector-number 262 -c LP --tag "Binder Trade"
\`\`\`

The collection's \`description\` — the blurb the published site prints above the
cards — is written the same way, on any list type:

\`\`\`bash
ritual metadata set "Main Binder" description "Everything I will trade away"
ritual metadata unset "Main Binder" description
\`\`\`

The collection's **cover image** on the published site is front matter too, but a
mapping rather than a scalar, so it has its own command instead of a
\`metadata\` property (see the **ritual** skill's *List cover images* section):

\`\`\`bash
ritual set-list-image "Main Binder" --card 12                 # a line in this collection
ritual set-list-image "Main Binder" --file alters/binder.png  # art-dir-relative
ritual set-list-image "Main Binder" --default                 # priciest printing again
\`\`\`

## Interactive management

${interactiveEditIntro({
  pick: 'pick a collection (or `➕ New Collection`) from its list selection menu to bulk-add cards',
})}

\`\`\`bash
ritual edit
ritual edit "Main Binder"            # open one collection directly (matches the file basename)
ritual edit --sets "FDN,SPG"         # restrict to these set codes
ritual edit --finish foil --condition NM
ritual edit --collector              # start in SET:CN printing search mode
ritual edit --allow-digital-only-cards
ritual edit --refresh never          # use the existing cache as-is, no prompt
ritual edit --refresh auto           # redownload the cache when prices are >1 day old
\`\`\`

${REFRESH_SESSION}

${sessionSemantics({
  fileNoun: 'file',
  editScope: "the collection's existing entries",
  editFields:
    "change a card's printing, finish, condition, language, label, tags, or note, move it to another list, or remove it",
  undoAddVerb: 'removes',
  changeKinds: 'adds, edits, and removals',
  discardTarget: 'same-card changes',
  discardAddEffect:
    "Discarding an add frees that card's `&N` id and keeps the remaining session ids dense (each later card slides down one).",
})}

## Compare with another list

${wrapProse(
  '`ritual diff` compares any two lists — e.g. which wanted cards a collection ' +
    `already covers, or what two collections share. ${DIFF_BY_MODES}`,
)}

\`\`\`bash
ritual diff wanted:to-buy "collection:Main Binder"          # overlap = already owned
ritual diff "Main Binder" trade-binder --by printing --output json
\`\`\`

## Import from a text file

${textImportSection({
  typeNoun: 'collection',
  typeFlag: 'collection',
  examples: `ritual import binder.txt --type collection
ritual import binder.txt --type collection --overwrite --no-input`,
  extra:
    'Every line must carry a printing (e.g. `2 Sol Ring (C19:221)`) — collections track specific physical printings, so name-only lines are rejected. A `[sale]` / `[trade]` / `[keep]` label token on a line is carried through to the collection (a wanted-list import drops it, since wanted lists carry no labels).',
})}

## Import from a CSV file

${csvImportSection({
  source: 'a CSV export (Moxfield, Deckbox, ManaBox, ...)',
  typeNoun: 'collection',
  examples: `ritual import binder.csv --type collection --name "Red Binder" \\
  --columns "name=1,set=2,collector-number=3,finish=4,condition=5,quantity=6"
ritual import more.csv --type collection --name "Red Binder" --append \\
  --columns "name=1,set=2,collector-number=3"`,
  requiredColumns: 'collections require `name`, `set`, and `collector-number` columns',
  appendNote: 'appends continue card IDs and record the changelog',
  typeNotes:
    'Conditions/finishes are normalized (e.g. `Near Mint` → `NM`, `F` → foil, empty → non-foil).',
})}

## Sync with Archidekt

${wrapProse(
  'Collection lists sync with the Archidekt collection of the **logged-in ' +
    'account** (`ritual login archidekt` first — the login records the numeric ' +
    'account id the collection is read by). An account has **one** collection ' +
    'while Ritual has **many** collection lists, so a run compares the union of ' +
    'the lists in scope against the whole remote collection. There is no ' +
    'per-file link and no front matter involved; the connection is the account.',
)}

\`\`\`bash
ritual collection-sync pull                         # remote → local, every collection list
ritual collection-sync push                         # local → remote, every collection list
ritual collection-sync pull "Blue Binder"           # scope the local side to named lists
ritual collection-sync push --dry-run               # preview, writing and sending nothing
ritual collection-sync pull --into "Blue Binder"    # land new cards in this list
ritual collection-sync push "Blue Binder" --only additions
ritual collection-sync pull --removal-priority "Long Box" --removal-priority "Blue Binder"
ritual collection-sync push --csv                   # new cards as one CSV import (no prompt)
ritual collection-sync push --csv-file import.csv   # write that CSV instead of pushing them
ritual collection-sync push --csv --refresh auto    # refresh a stale card cache instead of asking
ritual collection-sync pull --yes                   # accept losing lines the parser can't read
ritual collection-sync pull --output json           # scripted per-list report
\`\`\`

${wrapProse(
  '**Scope:** with no list arguments the local side is every collection list. Naming lists ' +
    'scopes the local side to those only — the remote side is **always** the ' +
    'whole Archidekt collection, so a subset run declares "these lists are what ' +
    'my Archidekt collection mirrors": cards living only in lists you did not ' +
    'name read as absent, so a push would delete their records and a pull would ' +
    'try to re-add them. Narrow such a run with `--only`.',
)}

${SYNC_CHANGE_FILTER}

${wrapProse(
  'That is what makes a subset scope safe with an incomplete local picture: ' +
    '`collection-sync push "Blue Binder" --only additions` uploads what that ' +
    'binder holds without the lists you did not name looking like cards you no ' +
    'longer own, and `collection-sync pull --only additions` adopts new ' +
    'Archidekt cards without deleting anything locally. `deck-sync` takes the ' +
    'identical flag (see the **ritual-decks** skill).',
)}

${wrapProse(
  '**Where pulled cards land:** a card that appeared on Archidekt belongs in *some* binder and nothing in the ' +
    'data says which, so every addition goes to one target list, resolved as: ' +
    '`--into <list>` for this run, else the `collectionSync.pullTarget` config ' +
    'key, else `Inbox`. The list is **created on first use**; a name two lists ' +
    'answer to fails the whole run before anything is fetched or written. ' +
    '`--into` applies to a pull only — passing it to a push warns and is ignored.',
)}

\`\`\`bash
ritual config set collectionSync.pullTarget "Inbox"
\`\`\`

${wrapProse(
  '**What is compared:** the join key is the printing (set code + collector number) plus finish and ' +
    "condition — Ritual's five conditions are exactly Archidekt's, so " +
    'NM/LP/MP/HP/DMG round-trip as-is. A line with no explicit finish resolves ' +
    'against the card cache first, so an etched-only printing compares as ' +
    'etched; a printing the cache does not hold syncs as nonfoil with a warning ' +
    'naming the line (that lookup is cache-only — a sync never fetches cards ' +
    'one at a time, so preload the cache first if finishes matter). Language ' +
    'round-trips: a `[ja]`-style token pulls down as, and pushes up as, that ' +
    "Archidekt language, and a code Archidekt's CSV cannot express pushes as " +
    'English with a warning naming the line. Tags and purchase price have no ' +
    'local representation: records Ritual creates are untagged and priceless, ' +
    'while existing values survive a quantity change. The game is ' +
    'fixed to Paper (no MTGO/Arena), and sections and notes are local-only — a ' +
    "pull adds into the target list's `Main`, a push flattens sections.",
)}

${wrapProse(
  '**A push with many new cards:** creating a printing costs a search plus a create, each rate-limit ' +
    'paced, so above **25 new printings** a push sends its additions through ' +
    "Archidekt's CSV importer instead — one upload, no searches, rows built " +
    'entirely from the local Scryfall cache (the same file ' +
    '`ritual export --preset archidekt` writes, in Archidekt’s spellings: ' +
    'variant `Normal`/`Foil`/`Etched`, and Damaged is `D`, not `DMG`). Quantity ' +
    'increases and removals never ride it — removals use Archidekt’s own ' +
    'bulk-delete API.',
)}

${wrapProse(
  '`--csv` always uploads (any count, no prompt); `--csv-file <path>` always ' +
    'writes the CSV **instead of** pushing the additions, which the report then ' +
    'counts as pending a manual upload at `archidekt.com/collections/import` ' +
    '(removals and quantity changes still push). The two flags contradict each ' +
    'other: giving both is a usage error (exit 2). Over the threshold with ' +
    'neither, a terminal is asked (upload / save to a file / add individually / ' +
    'cancel) and anything non-interactive **fails the run before any remote ' +
    'write**, naming both flags — the account is left untouched. A `--dry-run` ' +
    'over the threshold never prompts and makes no per-card request at all: it ' +
    'reports "would upload N cards (M rows) as a CSV import", which is what ' +
    'keeps a first preview from being rate limited. A printing the cache does ' +
    'not hold cannot become a row, so a real run adds it one at a time and a ' +
    'preview merely names it (`csv.uncached` in the report; `csv.status` is ' +
    '`"empty"` when the cache could key none of them).',
)}

${wrapProse(
  '**Cache freshness is required for the CSV path.** The rows are keyed by the ' +
    'Scryfall ids the local card cache holds, so a run taking that path checks ' +
    'the cache before building the file and `--refresh <ask|auto|no-bulk|never>` ' +
    'decides the rest: `ask` (the default) prompts with **yes** preselected, ' +
    '`auto` redownloads an empty or day-old cache without asking, and ' +
    '`no-bulk`/`never` — or a declined prompt, or no terminal to prompt on — ' +
    '**fail the run before any remote write** naming `ritual cache preload-all`. ' +
    'It never falls back to per-card searches, which is the rate limiting the ' +
    'CSV path exists to avoid. The server surfaces cannot prompt, so they treat ' +
    'freshness as `auto` and report the refresh in the run log.',
)}

${wrapProse(
  '**On the server surfaces** — the admin **Sync Collection** page and the MCP ' +
    '`sync_collection` tool — nothing can be prompted, so the request carries a ' +
    '`csv` boolean meaning exactly what `--csv` means: upload the new cards as ' +
    'one CSV import. The page’s *Upload new cards as one CSV import* toggle is ' +
    '**on by default** (turning it off is what makes a large push fail), and the ' +
    'MCP tool takes `csv: true`; without it an over-threshold push fails with ' +
    'the same guidance and pushes nothing. `--csv-file` is **CLI-only** — a ' +
    'request naming a `csvFile` is rejected, since a server does not write files ' +
    'a caller names — and `report.csv` (status, rows, chunks, per-row failures, ' +
    '`uncached`) is how either surface says what the import did.',
)}

${wrapProse(
  '**Removals a pull cannot place:** a removal is *ambiguous* only when **some** of a printing’s copies are ' +
    'going and those copies live in several lists — nothing says which binder ' +
    'the card left. Taking **every** copy is never ambiguous however many lists ' +
    'hold one (each simply loses what it holds), and neither is a partial ' +
    'removal whose copies all sit in one list (its last lines go).',
)}

${wrapProse(
  'An ambiguous removal must be settled before the pull writes **anything** — ' +
    'there is no partial, one-card-at-a-time sync. Two ways to settle it:',
)}

\`\`\`bash
# 1. Say up front which lists may give copies up, in priority order (repeatable)
ritual collection-sync pull --removal-priority "Long Box" --removal-priority "Blue Binder"
\`\`\`

${wrapProse(
  'Copies then come **only** from the named lists, walking them in the order ' +
    'given (each list’s last lines first). Names are matched exactly, like ' +
    '`--into` — never by the unique-substring rule — so an unknown or ambiguous ' +
    'name fails the run *before the remote collection is fetched* (the check is ' +
    'purely local, and so is the `--into` ambiguity check), as does a priority ' +
    'that cannot fully cover a removal. When a priority is given the run never ' +
    'prompts.',
)}

${wrapProse(
  '2. **Resolve them one by one.** With no priority, `--output text`, a ' +
    'terminal, prompts enabled (not `--no-input`) and no `--dry-run`, the run ' +
    'first asks whether to walk the copies (default **No**), then asks which ' +
    'list lost each copy, offering only the lists that still hold one. ' +
    'Declining, or cancelling part way, aborts everything — nothing is written. ' +
    '`--yes` does *not* answer these prompts; it covers unreadable lines only.',
)}

${wrapProse(
  '**Anywhere else** — `--output json`/`ndjson`, a pipe, `--no-input`, the ' +
    'admin site, or an MCP client that cannot be asked — the run **fails ' +
    'and writes nothing** — not even the account’s `lastSynced` — with the ' +
    'reason in the report’s `errors` and `unresolvedAmbiguity: true`; the ' +
    'report’s `ambiguous` array carries every ambiguity the planner found, ' +
    'placed or not, so the flag is what says the run failed on them. (The MCP ' +
    '`sync_collection` tool asks the user through an elicitation when its client ' +
    'supports one, and takes an explicit `removalAssignments` decision otherwise.) ' +
    '`--dry-run` never prompts and never fails on an ambiguity ' +
    'itself (an unknown `--removal-priority` name still fails it): it reports ' +
    'each one, and how a given priority would place it. Other ways out: ' +
    'scope the run to the one list, or `--only additions` to skip removals.',
)}

${wrapProse(
  '**Quantity prefixes:** a canonical collection (or wanted) line is one **copy** ' +
    'and carries no quantity, but the grammar reads one: a deck-style ' +
    '`- 4 Sol Ring (C21:240)` is four copies, and the next whole-file save (a pull, ' +
    'an editor save, `cleanup`) expands it to four lines — the first keeps the ' +
    '`&N`, the rest get fresh ids. A `collection-sync` run, a `cleanup` run, and ' +
    'the CLI editors each print an advisory naming the line (`Read 4 copies: …`); ' +
    'it is advisory only — nothing is lost and nothing is refused. A name that ' +
    'starts with a four-digit run (`1996 World Champion`) is a name, not a quantity.',
)}

${wrapProse(
  '**Push is last-writer-wins:** unlike `deck-sync push`, a collection push has ' +
    'no divergence guard — cards added on Archidekt since your last sync read as ' +
    'gone and are deleted. Preview with `--dry-run` (or use `--only additions`) ' +
    'when you also edit the collection on Archidekt.',
)}

${wrapProse(
  '**Unreadable lines:** both directions refuse a list whose file holds lines the parser cannot read, ' +
    'because both lose them: a pull rewrites the file, and a push treats the ' +
    'file as the truth (so the cards on those lines are deleted from your ' +
    'Archidekt collection). `-y`/`--yes` accepts that up front; without a ' +
    'terminal (`--no-input`, a pipe, or `--output json`) those lists fail ' +
    'instead. A push also refuses to run when nothing readable is in scope, ' +
    'rather than reading an empty local side as "the collection is empty".',
)}

${wrapProse(
  '**An incomplete local side:** when a list in scope does not make it into the comparison — a name that ' +
    'does not resolve, a file that cannot be read, or one held back for ' +
    'unreadable lines — the cards it holds look like they are only on ' +
    'Archidekt. The run therefore withholds exactly the changes that shortfall ' +
    'would manufacture: a pull adds nothing (it would duplicate that file into ' +
    'the target list) and a push removes nothing (it would delete those cards ' +
    'from Archidekt). Fix or accept the listed lists and run again; the ' +
    "report's `localIncomplete` flag says it happened.",
)}

${wrapProse(
  "The same sync runs from the admin site's **Sync Collection** page (see the " +
    '**ritual-site** skill) and from the MCP `sync_collection` tool, whose ' +
    '`direction`, `lists`, `only`, `into`, `removalPriority`, `csv`, `dryRun`, ' +
    'and `ignoreUnreadableLines` fields are these flags. The admin page cannot ' +
    'prompt, so it fails an ambiguous removal unless the run carries a removal ' +
    'priority; the MCP tool asks the user through an elicitation when its client ' +
    'declares the capability, and otherwise takes the decision up front as ' +
    '`removalPriority` or an explicit `removalAssignments` list (one or the ' +
    'other). Both refuse a large push that was not given `csv: true`.',
)}

## Price

${priceIntro({ scopeFlag: '--collection' })}

\`\`\`bash
ritual price --collection --summary            # every collection's totals
ritual price main-binder --no-input            # one collection's cards + totals
ritual price main-binder --output json --quiet
ritual price main-binder --sort price --descending --no-input
ritual price main-binder --prices eur          ${PRICE_CURRENCY_COMMENT}
ritual price main-binder --source cardkingdom    ${PRICE_SOURCE_COMMENT}
\`\`\`

Collection entries are priced at their exact printing and finish; totals include a
quantity-weighted unpriced-card count.

## Sell to Card Kingdom

\`sell\` matches cards against Card Kingdom's buylist ("Sell us your cards"): what CK is
buying, the cash quote per Near Mint copy, and their buy-quantity caps. It works from a
locally cached copy of CK's pricelist feed (~70 MB, fresh for a day). A feed already
downloaded is redownloaded automatically once it is a day old (under \`ask\` too, without
prompting); the first download prompts, or use \`--refresh auto\`. \`no-bulk\`/\`never\`
opt out and quote from whatever is cached. Defaults to every collection; accepts list names of
any type (\`deck:\`/\`collection:\`/\`wanted:\` prefixes disambiguate).

\`\`\`bash
ritual sell --refresh auto --output json        # everything CK buys from your collections
ritual sell main-binder --all --no-input        # one list, including skipped entries
ritual sell --sets dsk,fdn --min 0.50           # only these sets, offers ≥ $0.50/copy
ritual sell --output csv --out to-sell.csv      # CK sell-cart CSV (upload at cardkingdom.com/static/csvImport)
\`\`\`

Entries report \`status\` \`buying\` / \`not-buying\` (CK's buy quantity is 0) / \`no-match\`,
with \`sellableQuantity = min(owned, CK's cap)\` and \`value\` covering only those copies.
Quotes are cash for NM copies — played conditions grade down, store credit pays more.
Non-English entries (a \`[ja]\`-style language token) are **never quoted**: CK's feed is
English-only, so they report \`no-match\` with reason \`non-english\` rather than silently
quoting the English price for a foreign copy.
The \`csv\` output carries data rows only (CK's importer expects no header row) and uses CK's
own listing titles — their parenthesized variant note included, so variant printings land on the
right product — plus their edition spellings. It warns beyond their upload caps
(500 titles / 5,000 cards); etched foils export as plain foil with a warning.

To price an arbitrary set of printings rather than whole lists, use the MCP tool
\`get_buylist_quotes\` (or \`POST /api/buylist/quotes\`), which answers per
\`set:collectorNumber:finish\`. Both are cache-backed like \`sell\`: run
\`ritual sell --refresh auto\` (or the \`refresh_buylist\` tool) first.

Unlike the \`sell\` command, every *server* buylist surface is gated on sell mode (below):
\`get_sell_report\`, \`get_sell_cart\`, \`get_buylist_quotes\` and \`refresh_buylist\`, plus the
\`/api/sell/*\` and \`/api/buylist/*\` routes they reuse, answer \`Not found\` / 404 when it is
off. That is a config decision, not a missing feed — \`refresh_buylist\` will not fix it.

The same quotes drive **sell mode** on the admin site and on the public site: buylist prices
beside each card, buylist filters (on-buylist chips and a price threshold), buylist
grouping/sorting, and a CK cart export. It is **off by default** — turn it on with
\`ritual config set site.sellMode true\`, with the **Offer sell mode** checkbox on the admin's
Settings page (same key; unticking unsets it), or per run with \`--sell-mode\` on \`build-site\`,
\`serve\`, \`admin\`, or \`mcp\`. The public site reads quotes baked into its list JSON (no
backend needed); the admin site quotes live against its own API. Both servers answer quotes
strictly from the cache and never download per request; with sell mode on, each refreshes a
day-old feed once at startup (never the first one), and \`cache preload-all\` refreshes it
alongside the card cache.
`,
}
