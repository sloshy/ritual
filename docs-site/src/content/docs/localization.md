---
title: 'Localization'
description: How Ritual picks the language of its own interface, how that differs from the card language, and how to contribute a locale.
---

Ritual's interface text (CLI output, prompts, menus, help, and both web apps) goes through a message catalog, so the whole product can speak a language other than English. This page covers how the language is chosen on each surface, what Ritual can detect on each operating system, what stays English no matter what, and how to contribute a translation.

:::note[English is the only catalog that ships today]
The framework is in place and every user-facing string flows through it, but no translations are bundled yet. A build that ships only English resolves to English, hides the in-app language switcher, and never pays a detection cost. Adding a language is a pull request touching [one JSON file](#contributing-a-locale), with no TypeScript.
:::

## UI locale is not the card language

Ritual has two independent language settings. They are spelled differently so they never get confused:

|                      | **UI locale**                             | **Card language**                                                              |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| What it picks        | The language **Ritual itself** speaks     | Which **printing** of a card is recorded                                       |
| Config key           | `uiLocale`                                | [`defaultLanguage`](/configuration/#default-language)                          |
| Environment variable | `RITUAL_LOCALE`                           | —                                                                              |
| CLI flag             | `--locale <tag>`                          | —                                                                              |
| Per-card override    | —                                         | the `[ja]` line token                                                          |
| Vocabulary           | BCP-47 tags: `en`, `de-AT`, `pt-BR`, `ja` | Scryfall codes: `en ja zhs zht grc ph sa …`                                    |
| Cost of changing it  | None                                      | Non-English switches the card cache to Scryfall's much larger `all_cards` bulk |

The two are independent, and every combination is valid. **A German interface listing English printings is a perfectly normal setup**, and so is an English interface listing Japanese printings. Setting one never changes the other.

The vocabularies are not interchangeable either. `zhs`, `zht`, `grc`, `ph` and `sa` are Scryfall's own codes and are not UI locale tags; `de-AT` and `pt-BR` are not card languages. Ritual validates each against its own vocabulary and rejects the other's.

[`ritual locale`](/commands/locale/) prints both side by side, so the distinction is visible at the moment of confusion.

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

The flag wins when both it and the environment variable are given, and an empty or whitespace-only `RITUAL_LOCALE` counts as **not set**, the same rule every other [global option](/cli-conventions/#global-options) follows.

The three tiers differ in how strictly they are validated:

- **`--locale`** was typed by hand, so a tag the engine does not recognize is a usage error (exit code `2`) rather than a silent fallback. A typo is worth reporting.
- **`RITUAL_LOCALE`** warns and falls through to the next tier. An inherited variable should not be able to fail an unrelated command.
- **`uiLocale`** in `ritual.config.json` follows the usual [config validation](/configuration/#validation) path: a malformed value is reported and the default applies for that run.

An unusable interface language is a cosmetic problem, which is why only the flag refuses to run.

### Public site

```
__ritualLocale__ (test seam)  →  ?locale= in the hash query  →  localStorage
  →  navigator.languages, negotiated  →  the site's baked uiLocale  →  en
```

Picking a language from the header switcher stores it in `localStorage` under `ritual:locale`, so it survives reloads and applies across every page of the site. The `?locale=` hash query overrides the stored value, which makes a specific language shareable in a link:

```
https://example.com/#/deck/izzet-storm?locale=de
```

Only `navigator.languages` is **negotiated** against the locales the site actually ships (a browser asking for `de-AT` gets a shipped `de`). The explicit tiers are honored verbatim: a partially translated catalog falls back to English key by key, so an explicit choice is never second-guessed.

### Admin site

```
__ritualLocale__  →  localStorage  →  navigator.languages, negotiated
  →  uiLocale from GET /api/config  →  en
```

The admin has no hash query, so there is no `?locale=` tier. Its initial language comes from the same `uiLocale` config key the CLI reads, which means changing it on the **Settings** page (or with `config set`) relabels the admin with **no rebuild**. See [Admin → Settings](/admin/dashboard/#settings).

Both apps stamp `<html lang>` and `<html dir>` before first paint from a same-origin `boot.js`, so there is no flash of the wrong language and no stale `lang` left behind after a runtime switch.

## What Ritual can detect, per platform

Bun resolves **no** locale from the environment on its own. With `LANG=de_DE.UTF-8`, `Intl` still reports `en-US`. Ritual therefore reads the environment itself and hands an explicit tag to every formatter, so detection is only as good as what the environment actually says.

To see what each source says on **your** machine, including the subprocess probes the startup path declines to pay for, run [`ritual locale --detect`](/commands/locale/#detecting-the-os-locale).

### Linux and macOS (and any POSIX shell)

The standard chain is consulted in order, and the first entry that names a real language wins:

| Order | Variable      | Notes                                                        |
| ----- | ------------- | ------------------------------------------------------------ |
| 1     | `LC_ALL`      | Overrides everything, as `setlocale` does                    |
| 2     | `LC_MESSAGES` |                                                              |
| 3     | `LANGUAGE`    | GNU's colon-separated priority list (`ja:de`), messages only |
| 4     | `LANG`        |                                                              |

POSIX values are normalized to BCP-47: `de_DE.UTF-8` → `de-DE`, `zh_CN.GB18030` → `zh-CN`, `sr_RS@latin` → `sr-Latn-RS`. Unknown `@modifier` suffixes (`@euro`, `@valencia`) carry no BCP-47 meaning and are dropped.

Two rules to know:

- **`C`, `POSIX`, and `C.UTF-8` name no language** and are skipped rather than read as English. They are the default in most containers and on plenty of developer machines; treating them as a language would mean "detecting" a preference the user never expressed.
- **`LANGUAGE` is ignored entirely when the effective locale is `C`/`POSIX`**, matching GNU gettext: a user who asked for the C locale asked for untranslated output.

macOS interactive terminals set these variables, so the POSIX path covers them. Where they are unset, as in a GUI launch context or a `launchd` job, Ritual can ask macOS itself:

```bash
defaults read -g AppleLocale
```

That subprocess sits behind the same double gate as the Windows one below, so it never runs on the hot path of an English-only build. To pay for it deliberately, run [`ritual locale --detect`](/commands/locale/#detecting-the-os-locale).

### Windows

`cmd` and PowerShell set no `LANG`, and Bun exposes no Windows locale API. The POSIX chain is still checked first (Git Bash and MSYS do set it). Failing that, Ritual asks Windows directly:

```powershell
powershell -NoProfile -NonInteractive -Command "[Globalization.CultureInfo]::CurrentUICulture.Name"
```

That subprocess is **gated twice** and memoized. It runs only when no explicit flag, environment, or config value was given **and** the build ships more than one locale. An English-only build therefore never spawns it, and the shipping configuration's startup cost is exactly zero.

This means the shipping build normally answers "I don't know" on Windows. When you want the answer anyway, ask for it once and save it:

```powershell
ritual locale --detect
```

That runs every probe regardless of the gates, prints what each one said, and offers to write the result to `uiLocale`. After that no probe ever runs again, because an explicit value closes the gate. See [`locale --detect`](/commands/locale/#detecting-the-os-locale).

### WSL

**WSL cannot see the Windows host's language.** A WSL command is a Linux process: it inherits the distro's `LANG`, which is typically unset or `C.UTF-8`, and there is no supported way to read the host's region from inside it. Ritual does not probe `/mnt/c/.../powershell.exe`. Detection therefore falls through to `en`.

This is a limit of the process boundary, not a bug. `ritual locale --detect` reports it honestly: under WSL it shows the environment probe and marks both OS probes as not applicable, because a Linux process is exactly what it is.

WSL users, and Windows users who would rather not pay for the probe, should say so explicitly:

```bash
ritual config set uiLocale de     # per workspace
export RITUAL_LOCALE=de           # per shell, in ~/.bashrc or ~/.zshrc
```

Time zones need no workaround; Bun honors `TZ` normally.

## What never gets translated

Everything a human reads is localizable. Everything a **machine** reads is English by contract, in every locale, forever. Otherwise a translated build would silently produce files and payloads that Ritual, or your scripts, could no longer read.

| Contract                                                                                                 | Stays English because                                                                          |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Exit codes and `--output json` error `code` values                                                       | They are the machine handle scripts match on                                                   |
| `--output json` / `ndjson` **payload keys**                                                              | Same                                                                                           |
| `.changes.md` prose lines and their `ritual-changes` event block                                         | It is a git-diffable data format whose block is read back, and the prose is rendered beside it |
| Deck section names (`Main`, `Sideboard`, `Commander`, …)                                                 | They are parsed back out of your list files                                                    |
| CSV and [export](/commands/export/) headers, including the Archidekt dialect                             | Other tools import them                                                                        |
| Set codes, `&N` card IDs, `[ja]` / `[foil]` / `[etched]` / condition and label tokens                    | They are the file format                                                                       |
| `ritual.config.json` keys and values, deck format slugs, URL query values (`sort=`, `group=`, `labels=`) | Persisted identifiers; a shared list-view link must survive a language change                  |
| [MCP](/commands/mcp/) tool names, descriptions, and result `message` prose                               | They are LLM prompts, and tool names are protocol identifiers                                  |
| The installable [agent skills](/commands/skills/)                                                        | Same, plus their content hash decides "machine-managed vs user-edited"                         |
| These docs                                                                                               | Localizing them is a separate project                                                          |

Two consequences are easy to be surprised by:

- **`.changes.md` on disk stays English while the UI shows it translated.** The file is data. The change history you read in the CLI, the admin **Change History** page, and the site's **View Changes** modal is rendered from that data in your language.
- **Prices in CSV and export output never take a localized decimal separator.** A comma decimal separator inside a comma-delimited file would corrupt it, so exports format prices invariantly even when on-screen prices follow your locale.

To make error handling locale-proof, the structured error envelope carries a stable `messageKey` beside its existing `code`:

```json
{ "error": { "code": "usage_error", "messageKey": "errors.enum.invalid", "message": "…" } }
```

`code` and `messageKey` are locale-invariant; only `message` follows the UI locale. Match on the keys, never on the prose.

## Shipping locales with a built site

A built site carries its dictionaries as **data**, not as code: one `app.js`, plus one `locales/<tag>.json` per language. That is what lets a single build serve several languages, lets the running site switch language without a reload, and lets a released binary emit a locale it was never built with.

[`build-site`](/commands/build-site/#localized-builds) (and `serve --build`) take three flags:

| Flag                      | Meaning                                                                                                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--locale <tag>`          | The language the site **opens in**: `<html lang>`/`dir` and `index.json.uiLocale`. Defaults to the `uiLocale` config value.                                                                                                        |
| `--locales <tags...>`     | Which dictionaries to publish into `dist/locales/`. Default `en`; `all` publishes every one this build has. Populates `index.json.availableLocales`. **English is always published**, listed or not, and so is the `--locale` tag. |
| `--locale-file <path...>` | Load a dictionary JSON from disk at build time, named for its tag (`de-AT.json`). The locale analogue of `--theme-file`, and how a released binary ships a language it was not built with.                                         |

The in-app language switcher appears beside the theme control only when more than one locale was published. A picker with one option is noise.

Per-locale URL prefixes, if you want them for SEO or CDN path routing, are just a loop. No special mode exists:

```sh
for tag in en de ja; do
  ritual build-site --locale "$tag" --locales "$tag" --out-dir "dist/$tag"
done
```

Each prefixed build still carries English alongside its own language, since English is never dropped. So `dist/de/` opens in German with `en` available, and the language switcher appears on every one of them.

[`serve`](/commands/serve/) publishes `dist/locales/<tag>.json` as ordinary static files with no `Accept-Language` negotiation, so a CDN-hosted site and a locally served one are byte-identical deployments.

## Contributing a locale

Translators never touch TypeScript and never run `tsc`. English lives in `src/i18n/messages/en/*.ts` because it is the type source; every other language is a flat JSON file in `locales/`.

```sh
bun run scripts/check-locales.ts --emit-template de   # writes locales/de.json + de.meta.json
# translate locales/de.json
bun run scripts/check-locales.ts --report             # validate + per-locale coverage
```

`de.meta.json` is context, not output. It carries each key's **description** (the only context a translator gets) and, where one applies, a **length budget**.

A message value is either a plain string with `{named}` placeholders, a plural object, or a one-level variant object:

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

Placeholders are named rather than positional so you can **reorder them freely**. SOV word order is a first-class requirement.

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

Missing keys being only a warning is the important one. **`t()` falls back to English per key**, so you can open a pull request with 200 of 2,000 keys translated and it will ship and render correctly. Coverage is a number, not a gate.

A pull request touching only `locales/*.json` needs no behavioral code review. Validation is the gate.

### The pseudo-locale

`en-XA` is a generated pseudo-locale: English, accent-substituted, padded roughly 40% longer, and bracketed (`Add card` → `[Ȧḋḋ ƈȧřḋ~~~~~]`), with placeholders and plural structure preserved verbatim. It is regenerated from English on every build and is never committed or hand-edited.

It exists to catch, with zero translator time, the three things that break first: strings that never got routed through the catalog (they stay plain, unbracketed ASCII, which is visually obvious), layout that overflows under realistic length inflation, and English-fallback gaps.

### Namespaces and surface registration (for code contributors)

Message keys are partitioned into seven namespaces (`cli`, `help`, `site`, `admin`, `ui`, `domain`, `errors`), and each surface **registers** the namespaces it may render at boot: `src/i18n/register/cli.ts` (all seven, called from `main()`), `src/i18n/register/site.ts` (`site*`, `ui`, `domain`, `errors`), and `src/i18n/register/admin.ts` (the site set plus `admin`). This is what keeps the ~1,500 CLI-only messages out of the browser bundles: the English catalog reaches the runtime through registration, and `t.ts` imports the catalog's types only.

If you add a namespace or a new surface, add or extend a register module. `scripts/check-locales.ts` validates the registration lists (transitively) and fails a browser surface that registers `cli`/`help` or imports the full barrel as a value.

## Known gaps

- **Right-to-left languages are not supported yet.** `dir` is plumbed end to end, but the stylesheet still uses physical directions in places, so no RTL locale ships until that sweep lands.
- **One CLI multiselect prompt has an untranslatable instructions block**, hardcoded by the underlying prompt library. Exactly one multiselect exists in the CLI.
- **These docs are English only.** Localizing them is tracked as a separate project.
