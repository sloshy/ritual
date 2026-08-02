import type { RitualSkill } from '../types'
import { moxfieldUserAgentNote, REFRESH_COMMANDS, wrapProse } from './shared'

export const siteSkill: RitualSkill = {
  name: 'ritual-site',
  description:
    'Build, serve, and administer the Ritual website, wire up the CI publishing pipeline, and run the MCP server. Use when the user wants to generate the static site, preview it locally, set up publishing or CI (cache keys, changelog change detection for hand edits), verify or stamp list-file .sha256 sidecars to see which lists were hand-edited since Ritual last wrote them, open the web admin for editing lists, or expose Ritual to AI agents over MCP.',
  body: `# Building and serving a Ritual site

Ritual publishes your decks, collections, and wanted lists as a static website, and
offers a web admin for editing and an MCP server for AI agents.

## Initialize publishing

\`\`\`bash
ritual init-site                 # scaffold the CI workflow + gitignore for publishing
ritual init-site --force         # regenerate all managed files
ritual init-site --upgrade       # upgrade tracked workflows to this version
\`\`\`

Run bare in a terminal, \`init-site\` walks through its choices interactively. When
prompts are unavailable (\`--no-input\`, \`RITUAL_NO_INPUT\`, or no terminal), every
prompt must be pre-answered with a flag — a missing one is a usage error (exit 2)
naming the flag:

\`\`\`bash
ritual init-site --ci github-actions --deploy publish-for-me \\
  --change-detection --currency usd --no-skills
ritual init-site --ci manual --currency usd --no-skills
\`\`\`

Flags: \`--ci github-actions|manual\`, \`--deploy publish-for-me|local-build\`
(github-actions only), \`--dist-dir <dir>\` (local-build only),
\`--change-detection\`/\`--no-change-detection\` (publish-for-me only),
\`--currency usd|eur|tix\`, and \`--skills\`/\`--no-skills\` (install the Ritual agent
skills). Flags that do not apply to the chosen CI system or deploy mode are usage
errors. An existing \`README.md\` additionally needs \`--overwrite-readme\`,
\`--no-overwrite-readme\`, or \`--force\`; a pending version upgrade needs
\`--upgrade\`.

## CI / publishing pipeline

The generated GitHub Actions workflow is wired around three commands, just as
useful in a hand-rolled pipeline:

**\`ritual list-all-cards\`** prints a deduplicated, deterministically sorted
manifest of every unique card across all decks, collections, and wanted lists —
a stable fingerprint of what a build needs from Scryfall, designed to be a CI
cache key. \`--out <file>\` writes it to a file (relative to the base dir; \`-\`
means stdout), and \`--output text|json|ndjson\` picks the format (\`text\` is a
\`# All cards\` Markdown manifest; \`json\`/\`ndjson\` emit \`{name, set?,
collectorNumber?}\` objects with lowercase set codes). An unreadable list file
warns on stderr and sets exit code 1, but the (incomplete) manifest is still
emitted. The generated workflow writes \`all-cards.md\`, restores the \`cache/\`
directory keyed on that file's hash (with a prefix fallback to the newest
previous cache), then runs \`./ritual build-site --refresh auto\` — so the bulk
download reruns only when the cards the site needs actually changed.

**\`ritual detect-changes <commit>\`** (e.g. \`HEAD~1\`) makes hand-edited
lists show up in changelogs: it diffs the deck/collection/wanted files between
that commit and the working tree, appends changelog entries for lists whose
changes Ritual did not write itself, and renames or deletes \`.changes.md\`
sidecars to follow moved or deleted lists. A \`.sha256\` content-hash sidecar
means "Ritual wrote this exact content and already recorded its changelog", so
such a file is skipped; after appending, the sidecar is refreshed, making
detection idempotent. A file whose diff produced no card changes is *not*
stamped, so it keeps showing as drifted under \`--verify\` until
\`--hash-only\` stamps it. \`-n\`/\`--dry-run\` previews without writing;
\`--output json\` reports \`{mode: 'detect', commit, dryRun,
changelogsUpdated, renames, results, warnings}\`, where each warning is
\`{kind: 'missing-file' | 'parse', file, revision?, message}\`. Outside a git
repo, or with an unknown ref, it fails with a named error (exit 1) instead of
raw git output — a git failure that is neither is reported as such rather than
as "not a git repository". A file that changed in the range but is gone from
the working tree is skipped with a \`missing-file\` warning (the rest still
runs, exit 1); an unparseable line is a \`parse\` warning that does not change
the exit code. The card-ID backfill that
list-writing commands run refreshes a file's \`.sha256\` only when the sidecar
already matched the file, so a hand edit keeps its stale or absent sidecar and
\`detect-changes\` still records it — and \`detect-changes\` itself never
backfills, in any mode. With change detection enabled, the generated workflow
diffs against the pushed-from commit (falling back to the previous commit),
commits any updated changelogs back as \`github-actions[bot]\`, and skips the
rest of the build — that push re-triggers the workflow, and the second run
builds from the updated tree.

**\`ritual detect-changes --hash-only\`** stamps the \`.sha256\` sidecar for
every list file from its current content (never a \`.changes.md\` or
\`.primer.md\`), with no git and no changelog entries — the manual
"ritual-clean" stamp. It is destructive to history: any stamped file whose
content diverged from its sidecar (or never had one) will never receive
changelog entries for those edits, so the command names every such file in a
warning that prints even under \`--quiet\`. Only run it for edits you
deliberately do **not** want recorded (a restored backup, a bulk mechanical
rewrite). \`-n\`/\`--dry-run\` previews; \`--output json\` emits
\`{mode: 'hash-only', dryRun, stamped: [{file, priorState, hash}],
unrecordedEdits}\` where \`priorState\` is the sidecar state the stamp
overwrote.

**\`ritual detect-changes --verify\`** answers "which lists have been
hand-edited since Ritual last wrote them?" — it writes nothing and reports each
list file as \`clean\`, \`diverged\`, or \`no sidecar\`, exiting 1 when
anything has drifted (like \`cleanup --check\`, so CI or a pre-commit hook can
gate on it). \`--output json\` emits \`{mode: 'verify', files, clean,
diverged, missing}\`. \`--hash-only\` and \`--verify\` cannot be combined,
\`<commit>\` is not accepted with either, and \`--verify\` rejects
\`--dry-run\` (usage errors, exit 2).

## Build the static site

\`\`\`bash
ritual build-site                                          # build the configured selection into dist/
ritual build-site --decks "Winota Stax" "Mono-Red Aggro"   # specific decks
ritual build-site --collections "Main Binder"              # specific collections
ritual build-site --wanted-lists "To Buy"                  # specific wanted lists
ritual build-site --currencies usd,eur             # currencies to include (first is default)
ritual build-site --theme izzet                    # initial theme baked into the HTML
ritual build-site --theme-file my-theme.json       # load custom theme JSON files (their names become selectable)
ritual build-site --refresh never                  # build from cached data as-is
ritual build-site --refresh auto                   # refresh stale cache (bulk download allowed)
ritual build-site --out-dir ./preview               # build into another directory instead of dist/ (cleared first)
\`\`\`

\`--cache-images\` downloads card images locally instead of hot-linking Scryfall;
\`-v\`/\`--verbose\` lists the cards to be fetched.

${wrapProse(
  '`--decks` also accepts Archidekt, Moxfield, or MTGGoldfish deck URLs. ' +
    moxfieldUserAgentNote({ subject: 'URLs' }),
)}

${REFRESH_COMMANDS}
${wrapProse(
  'Headless builds (e.g. CI) should pass `--refresh auto` or `--refresh never` explicitly.',
)}

## Banning default printings

Ritual auto-selects each card's featured printing (the most recent non-outlier among its
five newest priced printings) when none is specified. To stop specific printings from ever
being featured, list them as \`SET:COLLECTOR\` keys; the next eligible printing is used instead.
Banned printings can still be viewed and entered manually.

\`\`\`bash
ritual config set --add site.bannedPrintings "SLD:123"     # ban one printing
ritual config set --remove site.bannedPrintings "SLD:123"  # un-ban it
\`\`\`

## Serve

\`\`\`bash
ritual serve                       # serve an already-built dist/ on :3000
ritual serve -p 8000
ritual serve --build               # build, then serve
ritual serve --build -p 8000 --host 127.0.0.1
ritual serve --build --api         # host the site with a live read-only backend
ritual serve --build --out-dir ./preview  # build into ./preview and serve THAT directory
\`\`\`

\`--out-dir\` is honoured by the server too: \`serve --build --out-dir X\` builds
into X and serves X. The directory is cleared before the build, so the Ritual
directory itself (or any ancestor of it, like \`.\`) is refused.

Build flags (\`--theme\`, \`--currencies\`, ...) only apply together with \`--build\`;
passing one without it is a usage error. \`--refresh\` is the exception: with
\`--api\` it also controls the startup cache warming, so it is valid on its own.

### Hosted mode (\`--api\`)

\`serve --api\` adds an unauthenticated, read-only API on the same port: list
JSON is computed from the markdown files per request (CLI/admin edits appear
without rebuilding), and the public editor's card search uses the card cache
with the admin editor's term matching instead of Scryfall. The trade page
follows suit: its search covers the wanted lists and the cache together (no
Scryfall toggle), and shared trade links resolve their cards from the cache.
There are no write routes — public edits still travel as export/import change
bundles.

For a split deployment (static site on a CDN, API hosted separately), set
\`site.apiBaseUrl\` to the API's URL before building; the site falls back to its
baked data when the API is unreachable:

\`\`\`bash
ritual config set site.apiBaseUrl "https://ritual-api.example.com"
ritual build-site
\`\`\`

## Web admin

\`ritual admin\` serves a browser UI for editing lists (the same operations as the CLI):

\`\`\`bash
ritual admin                       # http://0.0.0.0:8080
ritual admin -p 9000
ritual admin --theme izzet         # initial theme baked into the admin UI
ritual admin --refresh never       # skip the startup cache check, use cached data as-is
\`\`\`

With the \`admin.gitEnabled\` and \`admin.gitAutoCommit\` config keys set, saves
made through the admin UI (and the MCP server, which reuses the admin handlers)
are auto-committed to git (\`admin.gitAutoPush\` also pushes). CLI commands never
auto-commit.

The admin's **Import Changes** page applies a change-list JSON exported from the
public site's edit mode (a bundle covering one or more lists) with a per-list
preview before applying — the same operation as \`ritual import-changes\` (see the
**ritual-edit** skill) and the MCP \`import_change_bundle\` tool.

The admin's **Sync Decks** page runs \`deck-sync\` in the browser: pick a
direction, narrow the run to additions or removals only (the \`--only\` flag's
three-way control), toggle which Archidekt-linked decks to sync (all by default),
and watch per-deck progress stream in as it runs. Each deck shows when it last
synced, and the page signs in to Archidekt inline when the stored token has
expired. A deck whose file holds lines the parser cannot read is refused (a sync
would delete them) and shown with a "Sync anyway" confirmation. Same operation as
\`ritual deck-sync\` (see the **ritual-decks** skill) and the MCP
\`get_sync_status\` / \`sync_decks\` tools.

The admin's **Sync Collection** page is its counterpart for collections, running
\`ritual collection-sync\`: pick a direction, scope the run to the whole
collection or to selected lists, narrow it to additions or removals only, and
(on a pull) choose the list new cards land in — defaulting to the
\`collectionSync.pullTarget\` config key, created on first use. A pull also takes
an ordered **removal priority**, offering the lists in scope: the browser cannot
be prompted mid-run, so a removal whose copies span several lists is placed from
the lists named there, or the whole run fails without writing anything (not even
the account's last-sync time) and lists what it could not place. A **Preview
only** run reports such a removal instead of failing on it.
A push offers one control of its own — **Upload new cards as one CSV import**, on
by default: the browser cannot be asked mid-run either, and with it off a push
adding more new printings than Ritual will create one at a time fails without
pushing anything. What the import did (rows, requests, and any row Archidekt
refused) is reported when the run finishes.
Progress streams per list with a copies-moved tally, and lists holding lines the
parser cannot read are refused behind the same "Sync anyway" confirmation. The account's
last sync time is shown above the controls — a collection belongs to an account,
not to a file. Same operation as \`ritual collection-sync\` (see the
**ritual-collections** skill) and the MCP \`sync_collection\` tool.

It can also expose an MCP endpoint in the same process, on its own port
(\`--mcp-port\`, default 8765):

\`\`\`bash
ritual admin --mcp --mcp-token "$RITUAL_MCP_TOKEN"
ritual admin --mcp --mcp-token "$RITUAL_MCP_TOKEN" --mcp-port 9100
\`\`\`

**Account setup and recovery** (headless — no server started): \`ritual admin setup\`
creates the admin account ahead of the first browser visit (\`--username\` is
required, even on a terminal), \`ritual admin reset-password\` resets a lost
password (\`--username <name>\` also replaces the username; the TOTP enrollment is
preserved), and \`ritual admin disable-totp\` clears TOTP two-factor auth when the
authenticator is lost. On a terminal they prompt for the password; in scripts
pipe it with \`--password-stdin\`:

\`\`\`bash
ritual admin setup --username ops --password-stdin < password.txt
printf '%s\\n' "$NEW_PASSWORD" | ritual admin reset-password --password-stdin
ritual admin disable-totp --output json
\`\`\`

## MCP server (for AI agents)

\`ritual mcp\` runs a Model Context Protocol server exposing deck/collection/wanted
operations as tools — an alternative to driving the CLI for MCP-native clients:

\`\`\`bash
ritual mcp                                         # stdio transport (default)
ritual mcp --transport http --port 8765 --token "$RITUAL_MCP_TOKEN"
\`\`\`

The HTTP transport binds \`--host\` (default \`127.0.0.1\`). Without a token
(\`--token\` or \`RITUAL_MCP_TOKEN\`) it serves unauthenticated on loopback only —
on a non-loopback host it refuses to start unless \`--allow-unauthenticated\` is
passed explicitly.

Register it with Claude Code:

\`\`\`bash
claude mcp add ritual -- ritual mcp --base-dir /path/to/workspace
\`\`\`
`,
}
