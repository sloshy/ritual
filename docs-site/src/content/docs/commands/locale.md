---
title: 'locale'
---

Show which language Ritual's interface is speaking, **which setting decided that**, and
what the card language is — side by side, so the two are never confused.

## Usage

```bash
./ritual locale
./ritual locale --detect
```

Plain `locale` is read-only: it never writes `ritual.config.json`, never touches your
list files, and never triggers the [card-ID backfill](/#the-card-id-backfill) — the same
classification [`config set`](/commands/config/) has. The one thing that can write is
[`--detect`](#detecting-the-os-locale), and only after you answer its prompt with yes.
To _change_ the language directly, use `--locale`, `RITUAL_LOCALE`, or
[`config set uiLocale`](/commands/config/) — see
[Localization](/localization/#choosing-the-interface-language).

## Options

| Option              | Description                                                    | Default |
| ------------------- | -------------------------------------------------------------- | ------- |
| `--output <format>` | Output format: `text`, `json`, or `ndjson`                     | `text`  |
| `--quiet`           | Suppress the explanatory footer (never the report)             | `false` |
| `--detect`          | Ask the OS directly and offer to save the answer as `uiLocale` | `false` |

The report is the command's entire point, so it prints under `--quiet` too; only the
closing explanation and the footer are treated as chatter.

## Output

```text
$ ./ritual locale
UI locale: de-AT (--locale)
Available UI locales: en
Detected OS locale: de-DE
Card language (defaultLanguage): en

The UI locale is the language Ritual speaks; the card language selects which printing of a card is used. They are independent settings.
```

The detected value is reported as a normalized BCP-47 tag, not as the raw environment
value: a `LANG=de_DE.UTF-8` shows as `de-DE`.

Asking for a locale this build has no dictionary for — `de-AT` above, on an
English-only build — is **not** an error. The tag is honored (it still drives date,
number, and currency formatting) and every message falls back to English, which is why
the `Available` line is worth reading beside the first one.

| Line                     | What it tells you                                                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UI locale**            | The BCP-47 tag in force, and in parentheses **which tier supplied it**: `--locale`, `RITUAL_LOCALE`, `uiLocale in ritual.config.json`, `detected from the environment`, or `built-in default`. |
| **Available UI locales** | Every locale this build can actually render. An English-only build lists just `en`.                                                                                                            |
| **Detected OS locale**   | What the environment named, whether or not it won — `none` when the environment named nothing usable (`C.UTF-8`, an unset `LANG`, [WSL](/localization/#wsl)).                                  |
| **Card language**        | The [`defaultLanguage`](/configuration/#default-language) config value. A _different setting_, shown here on purpose.                                                                          |

A value that was present but unusable is reported as a warning above the report,
naming the tier and the reason — that is the answer to "why is this not the language I
asked for":

```text
RITUAL_LOCALE: ignoring invalid value — invalid UI locale: invalid locale tag: de_DE
Ignoring RITUAL_LOCALE "de_DE": invalid UI locale: invalid locale tag: de_DE
```

Two lines, because two things say so: the first comes from the locale resolution that
runs before **every** command, and the second is this report restating the rejection
beside the resolution it produced.

Such a value never fails the command: Ritual falls through to the next tier, because an
unusable interface language is cosmetic. The one exception is `--locale` itself, which
is validated by the flag parser and exits `2` — a tag typed by hand is a typo worth
reporting.

## Detecting the OS locale

Ordinary detection reads environment variables only, and the subprocess probes that ask
Windows or macOS directly are [gated off the startup path](/localization/#windows) — an
English-only build never spawns them. `--detect` is the opt-in that pays for them
anyway, reports what **every** source said, and offers to persist the answer:

```text
$ ./ritual locale --detect
UI locale: en (built-in default)
Available UI locales: en
Detected OS locale: none
Card language (defaultLanguage): en

Detection probes:
  Environment (LC_ALL, LC_MESSAGES, LANGUAGE, LANG): nothing set
  Windows UI culture (powershell -NoProfile -NonInteractive -Command "[Globalization.CultureInfo]::CurrentUICulture.Name"): de-DE → de-DE
  macOS system locale: not applicable on this platform
Detected de-DE, but the interface is using en (built-in default).
This build ships no dictionary for de-DE: messages would stay English, while dates, numbers, and currency would follow it.
? Set uiLocale to de-DE in ritual.config.json? › (Y/n)
```

Three sources are always listed, in the order they are consulted, and one that does not
apply to your platform is reported as skipped rather than left out — the report says
what was _not_ asked too:

| Source                  | What it asks                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------- |
| **Environment**         | `LC_ALL`, `LC_MESSAGES`, `LANGUAGE`, `LANG`, in that order — the ordinary path      |
| **Windows UI culture**  | `[Globalization.CultureInfo]::CurrentUICulture.Name`, via PowerShell (Windows only) |
| **macOS system locale** | `defaults read -g AppleLocale` (macOS only)                                         |

The offer only appears when a source names a language **different from the tag already
in force**, compared as an exact tag: `en-US` and `en` format dates and numbers
differently, so moving between them is a real change. Answering yes writes `uiLocale`
through exactly the same validation [`config set`](/commands/config/) uses; answering no
writes nothing.

Nothing is ever written without that yes. When prompting is impossible — `--no-input`,
`RITUAL_NO_INPUT`, or a stdin that is not a terminal — `--detect` prints the finding,
hands you the command that would apply it, and exits `0`:

```text
Not offering to save it (prompts are disabled by --no-input / RITUAL_NO_INPUT). To apply it, run: ritual config set uiLocale de-DE
```

Under `--output json`/`ndjson` there is no prompt either — prompt UI cannot share stdout
with a machine-readable document — and no line of prose. The payload's
`suggestedUiLocale` **is** the offer; act on it with `config set uiLocale`.

The probe findings are what you ran `--detect` for, so they print under `--quiet` too.

:::note
**WSL is still a hard limit.** A WSL command is a Linux process, so `--detect` runs the
environment probe and reports both OS probes as not applicable — there is no
`powershell.exe` under `/mnt/c` that Ritual will call. See
[Localization → WSL](/localization/#wsl).
:::

## JSON output

```bash
$ RITUAL_LOCALE=de-at ./ritual locale --output json
{
  "uiLocale": "de-AT",
  "source": "env",
  "requested": "de-at",
  "availableLocales": ["en"],
  "detectedOsLocale": "de-DE",
  "defaultLanguage": "en",
  "ignored": []
}
```

Every key and every value here is **locale-invariant** — `source` is one of `flag`,
`env`, `config`, `detected`, `default` in every language. `requested` is what the
winning tier supplied before canonicalization, and is absent when the built-in default
won; `detectedOsLocale` is absent when the environment named nothing.

`--locale` is canonicalized by the flag parser itself (a malformed value never gets
past it — see the exit `2` note above), so only the `env`, `config`, and `detected`
tiers can report a `requested` that differs from `uiLocale`.

This is the stable way to assert on locale resolution from a script, rather than
matching translated prose.

`--detect` adds two more keys, and only then:

```bash
$ ./ritual locale --detect --output json
{
  "uiLocale": "en",
  "source": "default",
  "availableLocales": ["en"],
  "defaultLanguage": "en",
  "ignored": [],
  "probes": [
    { "source": "environment", "ran": true, "origin": "LANG", "raw": "de_DE.UTF-8", "tag": "de-DE" },
    { "source": "windows", "ran": false, "origin": "powershell -NoProfile -NonInteractive -Command \"[Globalization.CultureInfo]::CurrentUICulture.Name\"" },
    { "source": "macos", "ran": false, "origin": "defaults read -g AppleLocale" }
  ],
  "suggestedUiLocale": "de-DE"
}
```

`source` is `environment`, `windows`, or `macos` in every language, and `ran` says
whether that source applied to this platform at all. `raw` is what it answered before
normalization, absent when it answered nothing; `tag` is absent when the raw value named
no usable language. `suggestedUiLocale` is absent when detection found nothing or agreed
with `uiLocale`.

`detectedOsLocale` is deliberately **not** widened by `--detect`: it stays what this run
detected under the ordinary gates, so a probe answering where the gated path declined to
ask cannot change what that field means.

## Examples

Check what a specific override would do, without changing anything:

```bash
./ritual --locale de locale
RITUAL_LOCALE=ja ./ritual locale
```

Confirm the two language settings are what you think they are:

```bash
./ritual locale --output json | jq '{uiLocale, defaultLanguage}'
```

Adopt whatever the OS says, on a machine where the environment does not say it:

```bash
./ritual locale --detect                       # asks first, writes uiLocale on yes
./ritual locale --detect --no-input            # prints the finding, writes nothing
./ritual locale --detect --output json | jq -r '.suggestedUiLocale // empty'
```

## Exit Codes

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| `0`  | Success (including when a locale value was ignored and reported)     |
| `1`  | Runtime error (e.g. a `ritual.config.json` that is not valid JSON)   |
| `2`  | Usage error — an invalid `--locale` tag, rejected by the flag itself |

## See also

- [Localization](/localization/) — precedence chains for every surface, OS detection
  limits, and how to contribute a locale
- [`config`](/commands/config/) — setting `uiLocale` persistently
- [Configuration → Default language](/configuration/#default-language) — the card
  language, which this command deliberately prints beside the UI locale
