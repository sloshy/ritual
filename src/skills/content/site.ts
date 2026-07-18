import type { RitualSkill } from '../types'

export const siteSkill: RitualSkill = {
  name: 'ritual-site',
  description:
    'Build, serve, and administer the Ritual website, and run the MCP server. Use when the user wants to generate the static site, preview it locally, set up publishing, open the web admin for editing lists, or expose Ritual to AI agents over MCP.',
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

## Build the static site

\`\`\`bash
ritual build-site                                          # build the configured selection into dist/
ritual build-site --decks "Winota Stax" "Mono-Red Aggro"   # specific decks
ritual build-site --collections "Main Binder"              # specific collections
ritual build-site --wanted-lists "To Buy"                  # specific wanted lists
ritual build-site --currencies usd,eur             # currencies to include (first is default)
ritual build-site --theme izzet                    # initial theme baked into the HTML
ritual build-site --refresh never                  # build from cached data as-is
ritual build-site --refresh auto                   # refresh stale cache (bulk download allowed)
\`\`\`

\`--cache-images\` downloads card images locally instead of hot-linking Scryfall.

The shared \`--refresh <mode>\` option controls card-cache freshness: \`ask\` (the
default) prompts about stale data — prompts that can't be answered are declined —
\`auto\` refreshes without asking, \`no-bulk\` refreshes stale prices per-card but
never bulk-downloads, and \`never\` uses the cache as-is. Headless builds (e.g. CI)
should pass \`--refresh auto\` or \`--refresh never\` explicitly.

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
ritual serve-site                  # build, then serve
ritual serve-site -p 8000 --host 127.0.0.1
\`\`\`

## Web admin

\`ritual admin\` serves a browser UI for editing lists (the same operations as the CLI):

\`\`\`bash
ritual admin                       # http://0.0.0.0:8080
ritual admin -p 9000
ritual admin --refresh never       # skip the startup cache check, use cached data as-is
\`\`\`

The admin's **Import Changes** page applies a change-list JSON exported from the
public site's edit mode (a bundle covering one or more lists) with a per-list
preview before applying — the same operation as \`ritual import-changes\` (see the
**ritual-edit** skill) and the MCP \`import_changes\` tool.

It can also expose an MCP endpoint in the same process:

\`\`\`bash
ritual admin --mcp --mcp-token "$RITUAL_MCP_TOKEN"
\`\`\`

**Account setup and recovery** (headless — no server started): \`ritual admin setup\`
creates the admin account ahead of the first browser visit, \`ritual admin
reset-password\` resets a lost password (\`--username <name>\` also replaces the
username; the TOTP enrollment is preserved), and \`ritual admin disable-totp\` clears
TOTP two-factor auth when the authenticator is lost. On a terminal they prompt for
the password; in scripts pipe it with \`--password-stdin\`:

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

Register it with Claude Code:

\`\`\`bash
claude mcp add ritual -- ritual mcp --base-dir /path/to/workspace
\`\`\`
`,
}
