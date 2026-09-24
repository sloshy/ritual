---
title: 'Localization'
description: How Ritual picks the language of its own interface, how that differs from the card language, and how to contribute a locale.
---

Ritual's interface text (CLI output, prompts, menus, help, and both web apps) comes from a message catalog, so the whole product can speak a language other than English. This page covers how each surface picks its language, what Ritual can detect on each operating system, what stays English no matter what, and how to contribute a translation.

:::note[English is the only catalog that ships today]
Every user-facing string flows through the catalog, but no translations are bundled yet. An English-only build resolves to English, hides the in-app language switcher, and never spawns the OS probe subprocesses. Adding a language is a pull request touching [one JSON file](#contributing-a-locale), with no TypeScript.
:::

## UI locale is not the card language

Ritual has two independent language settings:

|                      | **UI locale**                             | **Card language**                                                                   |
| -------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| What it picks        | The language **Ritual itself** speaks     | Which **printing** of a card is recorded                                            |
| Config key           | `uiLocale`                                | [`defaultLanguage`](/configuration/#default-language)                               |
| Environment variable | `RITUAL_LOCALE`                           | —                                                                                   |
| CLI flag             | `--locale <tag>`                          | —                                                                                   |
| Per-card override    | —                                         | the `[ja]` line token                                                               |
| Vocabulary           | BCP-47 tags: `en`, `de-AT`, `pt-BR`, `ja` | Scryfall codes: `en ja zhs zht grc ph sa …`                                         |
| Cost of changing it  | None                                      | Non-English switches the card cache to Scryfall's much larger `all_cards` bulk file |

Every combination is valid. A German interface listing English printings is a normal setup, and so is an English interface listing Japanese printings. Setting one never changes the other.

The vocabularies are not interchangeable. `zhs`, `zht`, `grc`, `ph` and `sa` are Scryfall codes, not UI locale tags; `de-AT` and `pt-BR` are not card languages. Ritual validates each key against its own vocabulary and rejects the other's.

[`ritual locale`](/commands/locale/) prints both settings side by side.

## Choosing the interface language

### CLI

```
--locale <tag>  →  RITUAL_LOCALE  →  uiLocale (config)  →  OS detection  →  en
```

```bash
ritual --locale de-AT lists          # this one run
RITUAL_LOCALE=de ritual lists        # this shell / this service unit
ritual config set uiLocale de        # this workspace, persistently
```

The flag wins over the environment variable. An empty or whitespace-only `RITUAL_LOCALE` counts as **not set**, like every other [global option](/cli-conventions/#global-options).

The tiers are validated differently:

- **`--locale`**: an unrecognized tag is a usage error (exit code `2`). You typed it, so a typo is worth reporting.
- **`RITUAL_LOCALE`**: an unusable value warns and falls through to the next tier. An inherited variable should not fail an unrelated command.
- **`uiLocale`** in `ritual.config.json`: follows the usual [config validation](/configuration/#validation). A malformed value is reported and the default applies for that run.

### Public site

```
__ritualLocale__ (test seam)  →  ?locale= in the hash query  →  localStorage
  →  navigator.languages, negotiated  →  the site's baked uiLocale  →  en
```

Picking a language from the header switcher stores it in `localStorage` under `ritual:locale`, so it survives reloads and applies to every page. The `?locale=` hash query overrides the stored value, which makes a language shareable in a link:

```
https://example.com/#/deck/izzet-storm?locale=de
```

Only `navigator.languages` is **negotiated** against the locales the site ships (a browser asking for `de-AT` gets a shipped `de`). The explicit tiers are honored as given: a partially translated catalog falls back to English key by key, so an explicit choice is never overridden.

### Admin site

```
__ritualLocale__  →  localStorage  →  navigator.languages, negotiated
  →  uiLocale from GET /api/config  →  en
```

The admin has no hash query, so there is no `?locale=` tier. Its initial language comes from the same `uiLocale` config key the CLI reads. Changing it on the **Settings** page (or with `config set`) relabels the admin with **no rebuild**. See [Admin → Settings](/admin/dashboard/#settings).

Both apps set `<html lang>` and `<html dir>` before first paint, so there is no flash of the wrong language and no stale `lang` after a runtime switch.

## What Ritual can detect, per platform

Bun resolves **no** locale from the environment on its own. With `LANG=de_DE.UTF-8`, `Intl` still reports `en-US`. Ritual reads the environment itself and hands an explicit tag to every formatter, so detection is only as good as what the environment says.

To see what each source says on **your** machine, including the subprocess probes that normal startup skips, run [`ritual locale --detect`](/commands/locale/#detecting-the-os-locale).

### Linux and macOS (and any POSIX shell)

Ritual checks the standard variables in order. The first one that names a real language wins:

| Order | Variable      | Notes                                                        |
| ----- | ------------- | ------------------------------------------------------------ |
| 1     | `LC_ALL`      | Overrides everything, as `setlocale` does                    |
| 2     | `LC_MESSAGES` |                                                              |
| 3     | `LANGUAGE`    | GNU's colon-separated priority list (`ja:de`), messages only |
| 4     | `LANG`        |                                                              |

POSIX values are normalized to BCP-47: `de_DE.UTF-8` → `de-DE`, `zh_CN.GB18030` → `zh-CN`, `sr_RS@latin` → `sr-Latn-RS`. Unknown `@modifier` suffixes (`@euro`, `@valencia`) have no BCP-47 meaning and are dropped.

Two rules to know:

- **`C`, `POSIX`, and `C.UTF-8` name no language.** They are skipped rather than read as English. They are the default in most containers and on many developer machines, and they express no preference.
- **`LANGUAGE` is ignored when the effective locale is `C`/`POSIX`**, matching GNU gettext.

macOS interactive terminals set these variables, so the POSIX path covers them. Where they are unset, as in a GUI launch context or a `launchd` job, Ritual can ask macOS itself:

```bash
defaults read -g AppleLocale
```

That subprocess is gated the same way as the Windows one below and never runs during normal startup of an English-only build. To run it deliberately, use [`ritual locale --detect`](/commands/locale/#detecting-the-os-locale).

### Windows

`cmd` and PowerShell set no `LANG`, and Bun exposes no Windows locale API. Ritual checks the POSIX variables first (Git Bash and MSYS set them). Failing that, it asks Windows directly:

```powershell
powershell -NoProfile -NonInteractive -Command "[Globalization.CultureInfo]::CurrentUICulture.Name"
```

That subprocess runs only when **both** hold: no explicit flag, environment, or config value was given, **and** the build ships more than one locale. Its result is remembered for the process. An English-only build never spawns it, so today's build normally answers "I don't know" on Windows.

To get the answer anyway, ask for it once and save it:

```powershell
ritual locale --detect
```

That runs every probe regardless of the gates, prints what each one said, and offers to write the result to `uiLocale`. After that no probe runs again, because an explicit value closes the gate. See [`locale --detect`](/commands/locale/#detecting-the-os-locale).

### WSL

**WSL cannot see the Windows host's language.** A WSL command is a Linux process. It inherits the distro's `LANG`, which is typically unset or `C.UTF-8`, and there is no supported way to read the host's region from inside it. Ritual does not probe `/mnt/c/.../powershell.exe`. Detection falls through to `en`.

`ritual locale --detect` reports this honestly: under WSL it shows the environment probe and marks both OS probes as not applicable.

WSL users, and Windows users who would rather skip the probe, should set the language explicitly:

```bash
ritual config set uiLocale de     # per workspace
export RITUAL_LOCALE=de           # per shell, in ~/.bashrc or ~/.zshrc
```

Time zones need no workaround; Bun honors `TZ` normally.

## What never gets translated

Everything a human reads is localizable. Everything a **machine** reads is English in every locale. Otherwise a translated build would produce files and payloads that Ritual, or your scripts, could no longer read.

| Contract                                                                                                 | Stays English because                                                         |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Exit codes and `--output json` error `code` values                                                       | Scripts match on them                                                         |
| `--output json` / `ndjson` **payload keys**                                                              | Same                                                                          |
| `.changes.md` prose lines and their `ritual-changes` event block                                         | It is a git-diffable data format that Ritual reads back                       |
| Deck section names (`Main`, `Sideboard`, `Commander`, …)                                                 | They are parsed back out of your list files                                   |
| CSV and [export](/commands/export/) headers, including the Archidekt dialect                             | Other tools import them                                                       |
| Set codes, `&N` card IDs, `[ja]` / `[foil]` / `[etched]` / condition and label tokens                    | They are the file format                                                      |
| `ritual.config.json` keys and values, deck format slugs, URL query values (`sort=`, `group=`, `labels=`) | Persisted identifiers; a shared list-view link must survive a language change |
| [MCP](/commands/mcp/) tool names, descriptions, and result `message` prose                               | They are LLM prompts, and tool names are protocol identifiers                 |
| The installable [agent skills](/commands/skills/)                                                        | Same, plus their content hash decides "machine-managed vs user-edited"        |
| These docs                                                                                               | Localizing them is a separate project                                         |

Two consequences may surprise you:

- **`.changes.md` on disk stays English while the UI shows it translated.** The file is data. The change history in the CLI, the admin **Change History** page, and the site's **View Changes** modal is rendered from that data in your language.
- **Prices in CSV and export output never use a localized decimal separator.** A comma decimal separator inside a comma-delimited file would corrupt it, so exports format prices invariantly even when on-screen prices follow your locale.

The structured error envelope carries a stable `messageKey` beside its `code`:

```json
{ "error": { "code": "usage_error", "messageKey": "errors.enum.invalid", "message": "…" } }
```

`code` and `messageKey` never change with the locale; only `message` does. Match on the keys, never on the prose.

## Shipping locales with a built site

A built site carries its dictionaries as **data**: one `app.js`, plus one `locales/<tag>.json` per language. One build can serve several languages, and the running site can switch language without a reload. A released binary can also ship a language it was never built with (see `--locale-file` below).

[`build-site`](/commands/build-site/#localized-builds) (and `serve --build`) take three flags:

| Flag                      | Meaning                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--locale <tag>`          | The language the site **opens in**: `<html lang>`/`dir` and `index.json.uiLocale`. Defaults to the `uiLocale` config value.                                                                |
| `--locales <tags...>`     | Which dictionaries to publish into `dist/locales/`. Default `en`; `all` publishes every one this build has. Populates `index.json.availableLocales`.                                       |
| `--locale-file <path...>` | Load a dictionary JSON from disk at build time, named for its tag (`de-AT.json`). The locale analogue of `--theme-file`, and how a released binary ships a language it was not built with. |

**English is always published**, listed or not, and so is the `--locale` tag. The in-app language switcher appears beside the theme control only when more than one locale was published.

For per-locale URL prefixes (for SEO or CDN path routing), loop over the tags. No special mode exists:

```sh
for tag in en de ja; do
  ritual build-site --locale "$tag" --locales "$tag" --out-dir "dist/$tag"
done
```

Each prefixed build still carries English, so `dist/de/` opens in German with `en` available, and the language switcher appears on every one.

[`serve`](/commands/serve/) publishes `dist/locales/<tag>.json` as ordinary static files with no `Accept-Language` negotiation, so a CDN-hosted site and a locally served one are byte-identical.

## Contributing a locale

Translators never touch TypeScript and never run `tsc`. English lives in `src/i18n/messages/en/*.ts` because it is the type source; every other language is a flat JSON file in `locales/`.

```sh
bun run scripts/check-locales.ts --emit-template de   # writes locales/de.json + de.meta.json
# translate locales/de.json
bun run scripts/check-locales.ts --report             # validate + per-locale coverage
```

`de.meta.json` is context, not output. It carries each key's **description** (the only context a translator gets) and, where one applies, a **length budget**.

A message value is a plain string with `{named}` placeholders, a plural object, or a one-level variant object:

```json
{
  "cli.menu.saveAndExit": "Speichern und beenden",
  "cli.addCard.added": {
    "$plural": "count",
    "one": "{count} Exemplar von {name} zu {list} hinzugefügt.",
    "other": "{count} Exemplare von {name} zu {list} hinzugefügt."
  }
}
```

Placeholders are named, not positional, so you can **reorder them freely**.

`check-locales.ts` runs as part of `bun run test` and `bun run verify`, and enforces:

| Check                                                                            | Severity                                                   |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| A key in English that your file is missing                                       | **Warning** — a partial locale must stay shippable         |
| A key your file has that English does not                                        | Error — stale or dead weight                               |
| Placeholder set differs from English                                             | Error — the placeholder would render as literal text       |
| A `$plural` entry whose categories are not exactly the ones the language has     | Error — Russian without `few` is wrong for 2–4             |
| A `$select` entry switching on a different parameter, or with different branches | Error                                                      |
| Unbalanced or literal `{` / `}`                                                  | Error                                                      |
| An invalid BCP-47 tag                                                            | Error                                                      |
| A value exceeding its `maxLen` budget                                            | Error — the interactive session menu has a hard row budget |

Missing keys are only a warning because **`t()` falls back to English per key**. A pull request with 200 of 2,000 keys translated ships and renders correctly. Coverage is a number, not a gate.

A pull request touching only `locales/*.json` needs no behavioral code review. Validation is the gate.

### The pseudo-locale

`en-XA` is a generated pseudo-locale: English, accent-substituted, padded roughly 40% longer, and bracketed (`Add card` → `[Ȧḋḋ ƈȧřḋ~~~~~]`), with placeholders and plural structure preserved. It is regenerated from English on every build and never committed or hand-edited.

It catches, with no translator time, the three things that break first: strings that never went through the catalog (they stay plain, unbracketed ASCII), layout that overflows under realistic length inflation, and English-fallback gaps.

### Namespaces and surface registration (for code contributors)

Message keys are partitioned into seven namespaces (`cli`, `help`, `site`, `admin`, `ui`, `domain`, `errors`). Each surface **registers** the namespaces it may render at boot: `src/i18n/register/cli.ts` (all seven, called from `main()`), `src/i18n/register/site.ts` (`site*`, `ui`, `domain`, `errors`), and `src/i18n/register/admin.ts` (the site set plus `admin`). Registration keeps the ~1,500 CLI-only messages out of the browser bundles; `t.ts` imports the catalog's types only.

If you add a namespace or a new surface, add or extend a register module. `scripts/check-locales.ts` validates the registration lists (transitively) and fails a browser surface that registers `cli`/`help` or imports the full barrel as a value.

## Known gaps

- **Right-to-left languages are not supported yet.** `dir` is plumbed end to end, but the stylesheet still uses physical directions in places, so no RTL locale ships until that is fixed.
- **One CLI multiselect prompt has an untranslatable instructions block**, hardcoded by the underlying prompt library. It is the only multiselect in the CLI.
- **These docs are English only.** Localizing them is a separate project.
