/**
 * Prose fragments shared by the skill content modules.
 *
 * Several skills describe the same behavior — the interactive edit session,
 * the `--refresh` modes, the `--no-input` guarantee, CSV/text imports, the
 * unified `price` command — and duplicated copies drift apart. The truly
 * common text lives here once, as constants and small builders; the real
 * per-type differences (editable fields, undo granularity, required CSV
 * columns, ...) stay in each skill as builder parameters.
 *
 * Everything here returns plain Markdown ready to interpolate into a skill
 * body. Paragraphs are hard-wrapped at {@link WRAP_WIDTH} columns so the
 * installed SKILL.md files read consistently; {@link asBullet} re-indents a
 * wrapped paragraph for use inside a Markdown list.
 */

/** Column budget for wrapped prose in installed SKILL.md files. */
const WRAP_WIDTH = 80

/** Hard-wrap a prose paragraph at {@link WRAP_WIDTH} columns without splitting words. */
export function wrapProse(text: string): string {
  const words = text.split(/\s+/).filter((word) => word.length > 0)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (current === '') {
      current = word
    } else if (current.length + 1 + word.length <= WRAP_WIDTH) {
      current = `${current} ${word}`
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current !== '') lines.push(current)
  return lines.join('\n')
}

/** Render a wrapped paragraph as a Markdown list item (`- ` plus continuation indent). */
export function asBullet(paragraph: string): string {
  return paragraph
    .split('\n')
    .map((line, index) => (index === 0 ? `- ${line}` : `  ${line}`))
    .join('\n')
}

/**
 * The global `--no-input` guarantee, phrased as a definition of the flag.
 * Used as a bullet in the **ritual** skill's global-options list and the
 * **ritual-edit** skill's shared conventions.
 */
export const NO_INPUT_GUARANTEE = wrapProse(
  `\`--no-input\` — **the** headless switch (the \`RITUAL_NO_INPUT\` environment ` +
    `variable does the same, and a falsy value — \`0\`/\`false\`/\`no\`/\`off\` — ` +
    `counts as unset): works on **every** command and guarantees no prompting; ` +
    `where input would be required the command fails fast with exit code 2 and a ` +
    `\`Input required: pass <flag> (...)\` message naming the flag (or uses a ` +
    `documented default) instead of hanging or exiting 0 having done nothing. A ` +
    `non-terminal stdin — every agent invocation — is treated exactly the same ` +
    `way, so the flag is never strictly required. There are no per-command ` +
    `non-interactive flags.`,
)

/**
 * The `--dry-run` side-effect guarantee for imports. One constant so every
 * list-type skill makes the same promise — it holds for all three types.
 */
export const IMPORT_DRY_RUN_GUARANTEE = wrapProse(
  `\`--dry-run\` resolves and validates everything but leaves the workspace ` +
    `byte-for-byte untouched — it does not even create the \`decks/\`, ` +
    `\`collections/\`, or \`wanted/\` directory it would have written into.`,
)

/**
 * The `--refresh <mode>` explanation scoped to an interactive edit session
 * (the variant the decks/collections/wanted skills print next to their
 * `ritual edit` examples).
 */
export const REFRESH_SESSION = wrapProse(
  `The shared \`--refresh <mode>\` option controls card-cache freshness: under ` +
    `\`ask\` (the default) a cache last fully downloaded more than a week ago ` +
    `prompts to redownload before the session starts; \`auto\` redownloads without ` +
    `prompting when the cached prices are more than a day old; \`no-bulk\` and ` +
    `\`never\` use the existing cache as-is.`,
)

/**
 * The `--refresh <mode>` explanation as a command-list overview (the variant
 * the **ritual**, **ritual-edit**, and **ritual-site** skills use; the site
 * skill appends its own CI-specific sentence).
 */
export const REFRESH_COMMANDS = wrapProse(
  `Commands that read the Scryfall card cache (\`add-card\`, \`edit\`, \`price\`, ` +
    `\`sell\` — where the mode also governs its Card Kingdom buylist cache — ` +
    `\`build-site\`, \`serve --build\`/\`--api\`, \`admin\`) share a \`--refresh <mode>\` ` +
    `option controlling cache freshness: \`ask\` (the default — prompt about stale ` +
    `or empty caches, skipping the prompt when prompts are unavailable; two ` +
    `exceptions download without asking: \`build-site\` bulk-downloads an empty or ` +
    `week-old card cache, since it cannot build a site without card data, and a ` +
    `Card Kingdom buylist already downloaded is redownloaded once it is a day ` +
    `old — by \`sell\`, and by \`admin\`/\`serve --api\` at startup — since a ` +
    `day-old feed quotes yesterday's offers; only the first buylist download ` +
    `prompts), \`auto\` ` +
    `(refresh stale data without asking, bulk download allowed), \`no-bulk\` ` +
    `(refresh stale prices per-card, never a bulk download), and \`never\` (use ` +
    `the cache as-is, making no request of any kind — under \`never\`, \`price\` ` +
    `reports uncached cards as unpriced instead of fetching them, and a ` +
    `\`build-site\` run with no cached symbology renders without mana symbols).`,
)

/** The real per-type differences in the interactive edit-session description. */
export type SessionSemanticsOptions = {
  /** Noun for what Save writes, e.g. 'deck file' or 'file'. */
  fileNoun: string
  /** What the edit-mode picker is over, e.g. "the deck's existing lines". */
  editScope: string
  /** The editable-field run for this type's edit mode. */
  editFields: string
  /** Optional extra sentence after the edit-mode description. */
  editModeNote?: string
  /** Verb for Undo Last Add: 'takes back' (deck lines) or 'removes' (single cards). */
  undoAddVerb: string
  /** How View Session Changes names its change kinds. */
  changeKinds: string
  /** The discard-ordering noun: 'same-line changes' or 'same-card changes'. */
  discardTarget: string
  /** What discarding an add does to the entry and its `&N` id. */
  discardAddEffect: string
}

/** Options for {@link sessionSavingSemantics}. */
export type SessionSavingSemanticsOptions = {
  /** Noun for what Save writes, e.g. 'deck file' or 'file'. */
  fileNoun: string
}

/**
 * The interactive session's saving semantics alone — the Save / Switch List /
 * Exit / changelog-entry facts — as one wrapped paragraph. The single source
 * of these facts: {@link sessionSemantics} embeds it for the per-type skills,
 * and the **ritual-edit** skill interpolates it directly.
 */
export function sessionSavingSemantics(options: SessionSavingSemanticsOptions): string {
  return wrapProse(
    `**Saving:** changes accumulate **in memory** — \`💾 Save\` writes the ` +
      `${options.fileNoun} and changelog without exiting. Backing out ` +
      `(\`🔀 Switch List\` or Esc) returns to the list selection menu **keeping ` +
      `unsaved changes in memory**, so edits can span several lists before one ` +
      `save — Save flushes every open list, and a separate \`💾 Save current ` +
      `list changes\` item appears when more than one open list has unsaved ` +
      `changes. \`🚪 Exit\` with anything unsaved opens an exit menu: save and ` +
      `exit, exit without saving (discards everything unsaved), or cancel to ` +
      `keep editing. Saving more than once in one session folds the later ` +
      `changes into that list's existing changelog entry (bumping its ` +
      `timestamp) — each saved list gets exactly one changelog entry per ` +
      `session.`,
  )
}

/**
 * The interactive session's save/edit/undo semantics, written once and
 * specialized per list type. Matches the unified editor's actual behavior
 * (`runCardSession` in src/commands/card-session.ts): Switch List / Esc backs
 * out keeping unsaved changes in memory, Save flushes every open list with a
 * separate save-current item, and Exit runs the shared exit menu.
 */
export function sessionSemantics(options: SessionSemanticsOptions): string {
  const saving = sessionSavingSemantics({ fileNoun: options.fileNoun })
  const editMode = wrapProse(
    `**Edit mode:** \`🛠️ Switch to Edit Mode\` turns the search prompt into a ` +
      `picker over ${options.editScope} — ${options.editFields} — and ` +
      `\`↩️ Undo Last Edit\` reverts the latest edit.` +
      (options.editModeNote === undefined ? '' : ` ${options.editModeNote}`),
  )
  const undo = wrapProse(
    `**Undo within the session:** \`↩️ Undo Last Add\` ${options.undoAddVerb} the ` +
      `most recent card, and \`📋 View Session Changes\` opens a picker over ` +
      `every change made this session — ${options.changeKinds} — where ` +
      `selecting one offers to discard just that change (${options.discardTarget} ` +
      `must be discarded newest-first). ${options.discardAddEffect}`,
  )
  return `${saving}\n\n${editMode}\n\n${undo}`
}

/** Options for {@link interactiveEditIntro}. */
export type InteractiveEditIntroOptions = {
  /** The type-specific middle clause: what to pick and what the session offers. */
  pick: string
}

/**
 * The per-type skills' introduction to `ritual edit`, framing the pointer to
 * the **ritual-edit** skill and the requires-a-terminal warning around a
 * type-specific middle clause.
 */
export function interactiveEditIntro(options: InteractiveEditIntroOptions): string {
  return wrapProse(
    `\`ritual edit\` opens the interactive editor (covered in full by the ` +
      `**ritual-edit** skill); ${options.pick}. It **requires a terminal**, so ` +
      `it is not suitable for non-interactive agents — use the one-shot ` +
      `commands instead.`,
  )
}

/** Options for {@link priceIntro}. */
export type PriceIntroOptions = {
  /** The type-scoping flag, e.g. '--deck'. */
  scopeFlag: string
}

/** The unified `price` command introduction, parameterized by the scope flag. */
export function priceIntro(options: PriceIntroOptions): string {
  return wrapProse(
    `The unified \`price\` command covers all list types; scope it with ` +
      `\`${options.scopeFlag}\` or a name. An interactive browser opens on a TTY — ` +
      `for agents, always pass \`--summary\`, \`--output json\`, or the global ` +
      `\`--no-input\` flag:`,
  )
}

/** The `--prices` example comment shared by every price example block. */
export const PRICE_CURRENCY_COMMENT = '# usd | eur | tix (defaults to config defaultCurrency)'

/**
 * The `--only <additions|removals>` change filter, described once for both sync
 * commands: `deck-sync` and `collection-sync` share the flag, its
 * destination-relative vocabulary, and its skipped-changes reporting, and only
 * differ in what the filter is *for*, which each skill adds after this.
 */
export const SYNC_CHANGE_FILTER = wrapProse(
  '`--only additions` / `--only removals` narrows a run to one side of the ' +
    'diff. The vocabulary is relative to the **sync destination** — the local ' +
    'files on a pull, Archidekt on a push — so additions are new cards and ' +
    'quantity increases *there*, removals are deleted cards and quantity ' +
    'decreases. The other side is still reported ("Skipped 3 removals (--only ' +
    'additions).") and simply not applied.',
)

/** The `ritual diff` matching-mode sentence (ends with a colon: an example block follows). */
export const DIFF_BY_MODES =
  `\`--by name\` (the default) matches card names; \`--by printing\` requires the ` +
  `exact set/collector-number/finish to match:`

/** Options for {@link moxfieldUserAgentNote}. */
export type MoxfieldUserAgentNoteOptions = {
  /** What needs the User-Agent in this context, e.g. 'imports' or 'URLs'. */
  subject: string
}

/** The Moxfield unique-User-Agent requirement. */
export function moxfieldUserAgentNote(options: MoxfieldUserAgentNoteOptions): string {
  return (
    `Moxfield ${options.subject} need a unique User-Agent: pass ` +
    `\`--moxfield-user-agent "you@example.com"\` or set \`MOXFIELD_USER_AGENT\`.`
  )
}

/** Options for {@link textImportSection}. */
export type TextImportSectionOptions = {
  /** Type noun in prose, e.g. 'collection' or 'wanted list'. */
  typeNoun: string
  /** The `--type` value agents must always pass, e.g. 'collection'. */
  typeFlag: string
  /** Bash example lines (no code fences). */
  examples: string
  /** Extra type-specific sentence(s) appended to the closing paragraph. */
  extra?: string
}

/** The decklist-style text-file import section shared by collections and wanted lists. */
export function textImportSection(options: TextImportSectionOptions): string {
  const intro = wrapProse(
    `\`import\` turns a decklist-style text file into a new ${options.typeNoun} ` +
      `(quantities expand to one bullet line per copy):`,
  )
  const closing = wrapProse(
    `Without \`--type\` an interactive run prompts for the list type; under the ` +
      `global \`--no-input\` flag the type defaults to a deck, so agents should ` +
      `always pass \`--type ${options.typeFlag}\`. A body line that is neither a ` +
      `section header nor a card line is skipped, listed on stderr, carried in ` +
      `the JSON \`warnings\` array, and exits 1 — the import is still written. ` +
      `Ritual's own format and the MTG Arena/MTGO export dialect ` +
      `(\`4 Lightning Bolt (M10) 146\`, bare \`Deck\`/\`Sideboard\` markers, a ` +
      `trailing \`*F*\`/\`*E*\` foil marker) are both read, as is the inside of a ` +
      `\`\`\` fence — on the import path only, since a pasted decklist usually ` +
      `arrives wrapped in one. A \`(SET)\` with no collector number is left in the ` +
      `card name rather than read as a printing; a line that imports but still ` +
      `holds a printing token in its name prints an advisory (stderr, JSON ` +
      `\`advisories\`) without failing the run.` +
      (options.extra === undefined ? '' : ` ${options.extra}`),
  )
  return `${intro}\n\n\`\`\`bash\n${options.examples}\n\`\`\`\n\n${closing}\n\n${IMPORT_DRY_RUN_GUARANTEE}`
}

/** Options for {@link csvImportSection}. */
export type CsvImportSectionOptions = {
  /** How the intro names the CSV source, e.g. 'a CSV export (Moxfield, Deckbox, ManaBox, ...)'. */
  source: string
  /** Type noun in prose, e.g. 'deck', 'collection', or 'wanted list'. */
  typeNoun: string
  /** Bash example lines (no code fences). */
  examples: string
  /** This type's required columns (a clause continuing "…column numbers; "). */
  requiredColumns: string
  /** What `--append` preserves for this type (parenthetical body). */
  appendNote: string
  /** Optional type-specific sentence(s) before the failed-rows sentence. */
  typeNotes?: string
}

/** The CSV import section shared by all three list types. */
export function csvImportSection(options: CsvImportSectionOptions): string {
  const intro = wrapProse(
    `A \`.csv\` source makes \`import\` import ${options.source} into a new ` +
      `${options.typeNoun}, or append to an existing one (\`--csv\` forces CSV ` +
      `parsing for other extensions). Non-interactive agents must pass all flags ` +
      `(running it bare opens an interactive column-mapping wizard):`,
  )
  const closing = wrapProse(
    `\`--columns\` maps fields to 1-based column numbers (fields: \`name\`, ` +
      `\`set\`, \`collector-number\`, \`condition\`, \`finish\`, \`language\`, ` +
      `\`section\`, \`quantity\` — language cells take Scryfall codes or aliases ` +
      `like \`JP\`/\`Japanese\`, and an empty cell means English; when no ` +
      `language column is mapped, pinned rows are stamped with the configured ` +
      `\`defaultLanguage\` when the printing exists in it); ` +
      `${options.requiredColumns}. Add \`--no-header\` when the ` +
      `first row is data — a scripted run without it drops the first row as a ` +
      `header and warns when that row looks like data. Add \`--overwrite\` to replace an existing ` +
      `${options.typeNoun}, or \`--append\` to add to one (${options.appendNote}).` +
      (options.typeNotes === undefined ? '' : ` ${options.typeNotes}`) +
      ` Rows naming the same card and printing merge into one line (create and ` +
      `append agree), and a \`--columns\` number the file has no column for is a ` +
      `usage error (exit 2) instead of a per-row failure. Failed rows are reported ` +
      `with line numbers on stderr and the rest still import (exit code 1 on ` +
      `partial failure).`,
  )
  return `${intro}\n\n\`\`\`bash\n${options.examples}\n\`\`\`\n\n${closing}`
}
