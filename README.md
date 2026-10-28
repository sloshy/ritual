# Ritual

<img src="app.svg" alt="Ritual icon" width="96" />

An all-in-one toolkit for Magic: The Gathering for your CLI and self-hosting needs.

See what a published site looks like in the [live demo](https://ritual.rpeters.dev/demo/), and read the docs at <https://ritual.rpeters.dev/>.

## Usage

For macOS/Linux, install as your user with:

```bash
curl -fsSL https://raw.githubusercontent.com/sloshy/ritual/main/scripts/install.sh | bash
```

For Windows (PowerShell), install as your user with:

```powershell
irm https://raw.githubusercontent.com/sloshy/ritual/main/scripts/install.ps1 | iex
```

To try the newest build, prereleases included:

```bash
curl -fsSL https://raw.githubusercontent.com/sloshy/ritual/main/scripts/install.sh | bash -s -- --prerelease
```

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/sloshy/ritual/main/scripts/install.ps1))) -Prerelease
```

Both scripts also accept `--version`/`-Version` for a specific release tag, and read the `RITUAL_PRERELEASE=1` and `RITUAL_VERSION=<tag>` environment variables.

You can also download binaries from the [releases page](https://github.com/sloshy/ritual/releases), or build from source with `bun run build`.

```bash
./ritual --help
```

📖 **Full documentation at [ritual.rpeters.dev](https://ritual.rpeters.dev)**

## License and Attribution

Ritual is free software under the [GNU Affero General Public License v3](LICENSE). See [NOTICE](NOTICE) for the full attribution.

Ritual is unofficial Fan Content permitted under the [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved or endorsed by Wizards of the Coast. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Card data, images and symbols come from [Scryfall](https://scryfall.com), which is not affiliated with this project.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for rules and guidelines.

## Development

This project uses [Bun](https://bun.sh) as its runtime. Install dependencies with:

```bash
bun install
```

Run commands locally without building:

```bash
bun run index.ts --help
```

Build a compiled binary:

```bash
bun run build
```

## Testing

**Unit Tests:**

```bash
bun run test
```

**Integration Tests:**

```bash
bun run test:it
```
