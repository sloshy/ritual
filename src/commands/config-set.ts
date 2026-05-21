import { Command } from 'commander'
import {
  loadRitualConfig,
  saveRitualConfig,
  type RitualConfig,
  type SiteSelectionConfig,
} from '../ritual-config'

type ConfigFieldType = 'string' | 'boolean' | 'number' | 'string[]'

// Maps a RitualConfig field's value type to its ConfigFieldType tag.
// Returns never for unmappable types (e.g. SiteConfig), which excludes them from SettableFieldsMap.
type ConfigFieldTypeFor<T> = T extends string
  ? 'string'
  : T extends boolean
    ? 'boolean'
    : T extends number
      ? 'number'
      : T extends string[]
        ? 'string[]'
        : never

// A mapped type over RitualConfig that only includes keys with a supported ConfigFieldType.
// The `site` key is automatically excluded because ConfigFieldTypeFor<SiteConfig | undefined> = never.
type SettableFieldsMap = {
  [K in keyof RitualConfig as ConfigFieldTypeFor<RitualConfig[K]> extends never
    ? never
    : K]: ConfigFieldTypeFor<RitualConfig[K]>
}

export type ArrayMode = 'replace' | 'add' | 'remove'

export type SettableValue = string | boolean | number | string[]

export type ConfigSetSuccess = {
  property: string
  newValue: SettableValue
  updatedConfig: RitualConfig
}

export type ConfigSetError = {
  error: string
}

export type ConfigSetOutcome = ConfigSetSuccess | ConfigSetError

// Typed as Record<string, ConfigFieldType> to allow runtime string-key lookups (noUncheckedIndexedAccess
// returns ConfigFieldType | undefined). The `satisfies SettableFieldsMap` check enforces that all keys
// are valid RitualConfig property names and each value matches that field's actual type.
export const SETTABLE_FIELDS: Record<string, ConfigFieldType> = {
  decksDir: 'string',
  collectionsDir: 'string',
  wantedDir: 'string',
  gitEnabled: 'boolean',
  gitAutoCommit: 'boolean',
  gitAutoPush: 'boolean',
  trustProxy: 'boolean',
  secureCookies: 'boolean',
  ipAllowList: 'string[]',
  ipDenyList: 'string[]',
  userAgentAllowList: 'string[]',
  userAgentDenyList: 'string[]',
  rateLimitEnabled: 'boolean',
  rateLimitMaxAttempts: 'number',
  rateLimitWindowMinutes: 'number',
  failedAuthDelayMs: 'number',
} satisfies SettableFieldsMap

// The public-site selection lists live under `site` but, unlike the rest of the
// init-site-managed `site` object, are user-tunable. They are exposed here as
// dotted nested paths handled through the same string[] machinery. The
// `satisfies` check keeps the keys in sync with SiteSelectionConfig.
type SiteSelectionFieldsMap = Record<`site.${keyof SiteSelectionConfig}`, 'string[]'>
const SETTABLE_SITE_FIELDS: Record<string, ConfigFieldType> = {
  'site.includeDecks': 'string[]',
  'site.includeCollections': 'string[]',
  'site.includeWantedLists': 'string[]',
} satisfies SiteSelectionFieldsMap

function getAtPath(obj: unknown, path: string[]): unknown {
  let current = obj
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function setAtPath(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  const head = path[0]
  if (head === undefined) return obj
  const rest = path.slice(1)
  if (rest.length === 0) {
    return { ...obj, [head]: value }
  }
  const nested =
    typeof obj[head] === 'object' && obj[head] !== null
      ? (obj[head] as Record<string, unknown>)
      : {}
  return { ...obj, [head]: setAtPath(nested, rest, value) }
}

export function applyConfigSet(
  config: RitualConfig,
  property: string,
  values: string[],
  mode: ArrayMode,
): ConfigSetOutcome {
  // The deployment portion of `site` is managed by init-site; only the
  // public-site selection lists may be set here.
  if (
    (property === 'site' || property.startsWith('site.')) &&
    !(property in SETTABLE_SITE_FIELDS)
  ) {
    return {
      error:
        'The "site" property is managed by "ritual init-site" and cannot be set with config-set, ' +
        'except for the public-site selection lists: ' +
        `${Object.keys(SETTABLE_SITE_FIELDS).join(', ')}.`,
    }
  }

  const fieldType = SETTABLE_FIELDS[property] ?? SETTABLE_SITE_FIELDS[property]
  if (!fieldType) {
    const available = [...Object.keys(SETTABLE_FIELDS), ...Object.keys(SETTABLE_SITE_FIELDS)].join(
      ', ',
    )
    return {
      error: `Unknown property: "${property}". Available properties: ${available}`,
    }
  }

  if (values.length === 0) {
    return { error: 'At least one value must be provided.' }
  }

  if (mode !== 'replace' && fieldType !== 'string[]') {
    return {
      error: `--add and --remove can only be used with array properties. "${property}" is a ${fieldType}.`,
    }
  }

  if (fieldType !== 'string[]' && values.length > 1) {
    return {
      error: `"${property}" is a ${fieldType} and only accepts one value, but ${values.length} were provided.`,
    }
  }

  const path = property.split('.')
  const configObj = config as unknown as Record<string, unknown>

  if (fieldType === 'string[]') {
    const current = (getAtPath(config, path) as string[] | undefined) ?? []
    let newArr: string[]

    if (mode === 'replace') {
      newArr = [...new Set(values)]
    } else if (mode === 'add') {
      const existing = new Set(current)
      newArr = [...current, ...values.filter((v) => !existing.has(v))]
    } else {
      const toRemove = new Set(values)
      newArr = current.filter((v) => !toRemove.has(v))
    }

    // Safe: path is a validated keyof RitualConfig, value is a string[].
    const updatedConfig = setAtPath(configObj, path, newArr) as unknown as RitualConfig
    return { property, newValue: newArr, updatedConfig }
  }

  // All scalar branches need exactly one value; the length checks above ensure this,
  // but noUncheckedIndexedAccess requires an explicit guard.
  const rawValue = values[0]
  if (rawValue === undefined) {
    return { error: 'At least one value must be provided.' }
  }

  if (fieldType === 'boolean') {
    const raw = rawValue.toLowerCase()
    if (raw !== 'true' && raw !== 'false') {
      return {
        error: `"${property}" expects a boolean. Use "true" or "false", got "${rawValue}".`,
      }
    }
    const newValue = raw === 'true'
    // Safe: path is a validated keyof RitualConfig, value matches the field's boolean type.
    const updatedConfig = setAtPath(configObj, path, newValue) as unknown as RitualConfig
    return { property, newValue, updatedConfig }
  }

  if (fieldType === 'number') {
    const trimmed = rawValue.trim()
    if (trimmed === '') {
      return { error: `"${property}" expects a number, got an empty string.` }
    }
    const num = Number(trimmed)
    if (!Number.isFinite(num)) {
      return { error: `"${property}" expects a number, got "${rawValue}".` }
    }
    if (!Number.isInteger(num)) {
      return { error: `"${property}" expects an integer, got "${rawValue}".` }
    }
    if (num < 0) {
      return { error: `"${property}" expects a non-negative integer, got "${rawValue}".` }
    }
    // Safe: path is a validated keyof RitualConfig, value matches the field's number type.
    const updatedConfig = setAtPath(configObj, path, num) as unknown as RitualConfig
    return { property, newValue: num, updatedConfig }
  }

  // fieldType === 'string'
  // Safe: path is a validated keyof RitualConfig, value matches the field's string type.
  const updatedConfig = setAtPath(configObj, path, rawValue) as unknown as RitualConfig
  return { property, newValue: rawValue, updatedConfig }
}

type ConfigSetOptions = {
  add?: boolean
  remove?: boolean
}

export function registerConfigSetCommand(program: Command): void {
  program
    .command('config-set')
    .description('Set or update a value in the ritual configuration file')
    .argument('<property>', 'Config property to set (use dot notation for nested: parent.child)')
    .argument('<value...>', 'Value(s) to set')
    .option('--add', 'Add value(s) to an array property instead of replacing it')
    .option('--remove', 'Remove value(s) from an array property')
    .action(async (property: string, values: string[], options: ConfigSetOptions) => {
      if (options.add && options.remove) {
        console.error('Error: --add and --remove cannot be used together.')
        process.exit(1)
      }

      const mode: ArrayMode = options.add ? 'add' : options.remove ? 'remove' : 'replace'
      const config = await loadRitualConfig()
      const outcome = applyConfigSet(config, property, values, mode)

      if ('error' in outcome) {
        console.error(`Error: ${outcome.error}`)
        process.exit(1)
      }

      await saveRitualConfig(outcome.updatedConfig)

      const displayValue = Array.isArray(outcome.newValue)
        ? JSON.stringify(outcome.newValue)
        : String(outcome.newValue)
      console.log(`Set ${outcome.property} = ${displayValue}`)
    })
}
