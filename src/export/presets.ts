import {
  parseExportColumns,
  DEFAULT_EXPORT_COLUMNS,
  EXPORT_DIALECTS,
  isExportDialect,
  type ExportDialect,
  type ExportProperty,
} from './render'

export type ExportFormat = 'csv' | 'json' | 'text' | 'md'

export const EXPORT_FORMATS = [
  'csv',
  'json',
  'text',
  'md',
] as const satisfies readonly ExportFormat[]

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value)
}

/**
 * File extension for a format's default output filename (`export.<ext>`). The
 * `text` format writes `.txt`; the others match their format name.
 */
export const EXPORT_FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  csv: 'csv',
  json: 'json',
  text: 'txt',
  md: 'md',
}

/**
 * Whether a format's output shape is a column selection. Text and markdown
 * exports have fixed line formats, so the column and CSV options don't apply
 * to them (giving those flags alongside `--format text|md` is a usage error;
 * a preset's stored columns are simply unused).
 */
export function exportFormatUsesColumns(format: ExportFormat): boolean {
  return format === 'csv' || format === 'json'
}

/**
 * A saved export configuration: output shape only (format, columns and their
 * order, CSV toggles) — never sources or filters, which describe a particular
 * export rather than a reusable shape. Stored under `exportPresets` in
 * ritual.config.json, keyed by preset name.
 */
export type ExportPreset = {
  format: ExportFormat
  /** Always stored; only csv/json output reads it (text/md lines are fixed). */
  columns: ExportProperty[]
  /** CSV only; emit the header row. Defaults to true. */
  header?: boolean
  /** CSV only; quote every cell. Defaults to false. */
  quoteAll?: boolean
  /** Value vocabulary for finish/condition. Defaults to `ritual`. */
  dialect?: ExportDialect
}

/**
 * The CSV Archidekt's collection importer takes, and what
 * `ritual collection-sync push` uploads for its additions:
 * `Scryfall ID,Quantity,Variant,Condition,Language` under a header row, with
 * Archidekt's own value spellings. Uid-keyed rows need no name matching, so
 * every row is unambiguous by construction.
 */
const ARCHIDEKT_PRESET: ExportPreset = {
  format: 'csv',
  columns: ['scryfallId', 'quantity', 'finish', 'condition', 'language'],
  header: true,
  quoteAll: false,
  dialect: 'archidekt',
}

/**
 * Presets Ritual ships with, available by name without any config. A saved
 * preset of the same name wins (user config beats built-in defaults, as
 * everywhere else) — nothing here is load-bearing for a feature: the collection
 * sync builds its upload from {@link ARCHIDEKT_EXPORT_SETTINGS} directly, so
 * shadowing `archidekt` only changes what `ritual export --preset archidekt`
 * writes.
 */
export const BUILT_IN_EXPORT_PRESETS: Record<string, ExportPreset> = {
  archidekt: ARCHIDEKT_PRESET,
}

/**
 * The resolved output shape of the built-in `archidekt` preset — what the
 * collection sync renders its CSV upload with, independent of any saved preset
 * of that name.
 */
export const ARCHIDEKT_EXPORT_SETTINGS: ResolvedExportSettings = resolveExportSettings(
  ARCHIDEKT_PRESET,
  {},
)

/**
 * A preset by name: a saved one first, then the built-ins. Undefined when
 * neither has it — callers report that with {@link exportPresetNames}.
 */
export function findExportPreset(
  name: string,
  saved: Record<string, ExportPreset>,
): ExportPreset | undefined {
  return saved[name] ?? BUILT_IN_EXPORT_PRESETS[name]
}

/** Every usable preset name — saved ones first, then built-ins they don't shadow. */
export function exportPresetNames(saved: Record<string, ExportPreset>): string[] {
  const names = Object.keys(saved)
  return [...names, ...Object.keys(BUILT_IN_EXPORT_PRESETS).filter((name) => !names.includes(name))]
}

/**
 * Parse the `exportPresets` config value. Returns the validated preset map,
 * an empty map when absent, or an error string when malformed (following the
 * config module's warn-and-ignore convention).
 */
export function parseExportPresets(value: unknown): Record<string, ExportPreset> | string {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return '"exportPresets" must be an object mapping preset names to presets'
  }
  const presets: Record<string, ExportPreset> = {}
  for (const [name, raw] of Object.entries(value)) {
    const parsed = parsePreset(name, raw)
    if (typeof parsed === 'string') return parsed
    presets[name] = parsed
  }
  return presets
}

function parsePreset(name: string, raw: unknown): ExportPreset | string {
  const label = `exportPresets["${name}"]`
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return `${label} must be an object`
  }
  const candidate = raw as Record<string, unknown>
  if (typeof candidate.format !== 'string' || !isExportFormat(candidate.format)) {
    return `${label}.format must be one of: ${EXPORT_FORMATS.join(', ')}`
  }
  if (!Array.isArray(candidate.columns)) {
    return `${label}.columns must be an array of property names`
  }
  const columns = parseExportColumns(candidate.columns)
  if (typeof columns === 'string') {
    return `${label}.columns: ${columns}`
  }
  if (candidate.header !== undefined && typeof candidate.header !== 'boolean') {
    return `${label}.header must be a boolean`
  }
  if (candidate.quoteAll !== undefined && typeof candidate.quoteAll !== 'boolean') {
    return `${label}.quoteAll must be a boolean`
  }
  if (
    candidate.dialect !== undefined &&
    (typeof candidate.dialect !== 'string' || !isExportDialect(candidate.dialect))
  ) {
    return `${label}.dialect must be one of: ${EXPORT_DIALECTS.join(', ')}`
  }
  const preset: ExportPreset = { format: candidate.format, columns }
  if (candidate.header !== undefined) preset.header = candidate.header
  if (candidate.quoteAll !== undefined) preset.quoteAll = candidate.quoteAll
  if (candidate.dialect !== undefined) preset.dialect = candidate.dialect
  return preset
}

/**
 * The output-shape flags a caller may have given explicitly. `undefined` means
 * "not given" (the flags must be registered without commander defaults so a
 * preset can fill them in).
 */
export type ExportSettingsFlags = {
  format?: ExportFormat
  columns?: ExportProperty[]
  header?: boolean
  quoteAll?: boolean
  dialect?: ExportDialect
}

/** Fully resolved output shape used by the renderers. */
export type ResolvedExportSettings = {
  format: ExportFormat
  columns: ExportProperty[]
  header: boolean
  quoteAll: boolean
  dialect: ExportDialect
}

/**
 * Resolve the output shape with defaults → preset → explicit flags precedence.
 */
export function resolveExportSettings(
  preset: ExportPreset | undefined,
  flags: ExportSettingsFlags,
): ResolvedExportSettings {
  return {
    format: flags.format ?? preset?.format ?? 'csv',
    // Copied, never aliased: the resolved settings are handed to renderers that
    // take a mutable array, and a preset (or the shared default) whose array they
    // sorted in place would change the shape of every later export — including the
    // CSV a collection push uploads, which resolves the built-in preset once at
    // module load.
    columns: [...(flags.columns ?? preset?.columns ?? DEFAULT_EXPORT_COLUMNS)],
    header: flags.header ?? preset?.header ?? true,
    quoteAll: flags.quoteAll ?? preset?.quoteAll ?? false,
    dialect: flags.dialect ?? preset?.dialect ?? 'ritual',
  }
}
