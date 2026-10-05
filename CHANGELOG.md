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
- The Docker image creates `/app/wanted`, keeps `/app/.logins` private (mode 0700), and exposes the default ports of `admin` (8080)
  and `cache server` (4000) as well as `serve` (3000).
