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
ritual build-site                                  # build the configured selection into dist/
ritual build-site --decks winota-stax other-deck   # specific decks
ritual build-site --collections main-binder        # specific collections
ritual build-site --wanted-lists to-buy            # specific wanted lists
ritual build-site --currencies usd,eur             # currencies to include (first is default)
ritual build-site --theme izzet                    # initial theme baked into the HTML
ritual build-site --no-refresh                     # build from cached data as-is
ritual build-site --allow-refresh                  # refresh stale cache (bulk download)
\`\`\`

\`--cache-images\` downloads card images locally instead of hot-linking Scryfall.

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

It can also expose an MCP endpoint in the same process:

\`\`\`bash
ritual admin --mcp --mcp-token "$RITUAL_MCP_TOKEN"
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
