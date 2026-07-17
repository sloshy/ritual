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

## Build the static site

\`\`\`bash
ritual build-site                                          # build the configured selection into dist/
ritual build-site --decks "Winota Stax" "Mono-Red Aggro"   # specific decks
ritual build-site --collections "Main Binder"              # specific collections
ritual build-site --wanted-lists "To Buy"                  # specific wanted lists
ritual build-site --currencies usd,eur             # currencies to include (first is default)
ritual build-site --theme izzet                    # initial theme baked into the HTML
ritual build-site --no-refresh                     # build from cached data as-is
ritual build-site --allow-refresh                  # refresh stale cache (bulk download)
\`\`\`

\`--cache-images\` downloads card images locally instead of hot-linking Scryfall.

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
ritual admin --no-refresh
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
