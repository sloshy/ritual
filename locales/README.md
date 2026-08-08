# Locales

Translated message catalogs, one flat JSON file per BCP-47 tag (`de.json`,
`pt-BR.json`, `ja.json`). This directory is data: adding a language is a pull
request touching one file plus a validator run, with no TypeScript involved.

**English is not here.** `en` is authored as TypeScript in
`src/i18n/messages/en/*.ts` because it is the type source — it is what makes a
stale `t()` call site a compile error. Every file in this directory is validated
against it.

`en-XA.json` is the generated pseudo-locale (accented, padded, bracketed). It is
written by `scripts/generate-locales.ts` on every build and is gitignored —
never edit it, and never translate it.

## Adding a locale

```sh
bun run scripts/check-locales.ts --emit-template de   # writes de.json + de.meta.json
# edit de.json; de.meta.json carries each key's description and length budget
bun run scripts/check-locales.ts --report             # validate + coverage table
```

Rules the validator enforces:

- Keys must exist in the English catalog. Extra keys are a hard failure; missing
  keys are only a coverage number, because a partially translated locale must
  stay shippable — `t()` falls back to English per key.
- `{placeholders}` must match English exactly, but may be reordered freely.
  Literal `{` and `}` are not allowed.
- A `$plural` entry must supply exactly the CLDR categories its language has
  (`Intl.PluralRules('ru')` → `one`, `few`, `many`, `other`).
- A `$select` entry must switch on the same parameter and carry the same
  branches as English.
- `maxLen` budgets (see `<tag>.meta.json`) are terminal-column budgets, not
  character counts — the interactive session menu has a hard row budget.

Text that is **English by contract** never appears here: `.changes.md` prose,
CSV and export headers, persisted slugs and tokens, set codes, MCP tool prose,
and the agent skills.
