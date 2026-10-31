import { describe, expect, test } from 'bun:test'
import { Argument, Command, CommanderError, Option } from 'commander'
import {
  buildProgram,
  COMMANDER_ERROR_RULES,
  localizeCommanderError,
  localizeHelpTitle,
  localizedArgumentDescription,
  localizedOptionDescription,
  requestsFullHelp,
  type CommandGroup,
} from '../../../src/cli/program'
import { COMMAND_GROUPS } from '../../../src/commands/registry'
import { NO_UPDATE_NOTICE } from '../../helpers/cli'
import { COMMANDS_WITH_ID_BACKFILL } from '../../../src/commands/id-backfill'
import { t } from '../../../src/i18n/t'
import {
  expectLocaleInForce,
  pseudoCatalog,
  pseudoString,
  withSyntheticLocale,
} from '../../helpers/sync-text'

/**
 * The backfill allowlist and the command registry are maintained by hand in two
 * files; an entry naming a command that is not registered would silently never
 * backfill. Qualified names (`deck-sync pull`) resolve through the subcommand.
 */
/** The real tree: every registered command, as `ritual` builds it. */
function realProgram(): Command {
  return buildProgram({
    groups: COMMAND_GROUPS,
    backfill: () => false,
    workspaceCheck: () => Promise.resolve(),
    updateNotice: NO_UPDATE_NOTICE,
  })
}

/**
 * A one-command program built the way `ritual`'s is (so it carries every
 * localized hook), its `probe` subcommand configured by `configure`.
 */
function probeCommand(configure: (probe: Command) => void): Command {
  const program = buildProgram({
    groups: [
      {
        titleKey: 'help.group.utilities',
        commands: [
          (root) => {
            const probe = root.command('probe').action(() => undefined)
            configure(probe)
          },
        ],
      },
    ],
    backfill: () => false,
    workspaceCheck: () => Promise.resolve(),
    updateNotice: NO_UPDATE_NOTICE,
  })
  const probe = program.commands.find((command) => command.name() === 'probe')
  if (probe === undefined) throw new Error('the probe command was not registered')
  return probe
}

describe('buildProgram', () => {
  const program = buildProgram({
    groups: COMMAND_GROUPS,
    backfill: () => false,
    workspaceCheck: () => Promise.resolve(),
    updateNotice: NO_UPDATE_NOTICE,
  })

  test('every COMMANDS_WITH_ID_BACKFILL entry names a registered command', () => {
    expect(COMMANDS_WITH_ID_BACKFILL.length).toBeGreaterThan(10)
    const registered = new Set<string>()
    for (const command of program.commands) {
      registered.add(command.name())
      for (const sub of command.commands) registered.add(`${command.name()} ${sub.name()}`)
    }
    const missing = COMMANDS_WITH_ID_BACKFILL.filter((name) => !registered.has(name))
    expect(missing).toEqual([])
  })

  test('the registry registers every command, in --help order', () => {
    // The tree is hand-maintained data now; a registrar dropped from
    // COMMAND_GROUPS would otherwise vanish from the CLI without a failing test.
    expect(program.commands.map((command) => command.name())).toEqual([
      'new',
      'import',
      'add-card',
      'edit',
      'admin',
      'lists',
      'card',
      'scry',
      'price',
      'build-site',
      'serve',
      'rename',
      'delete',
      'metadata',
      'categories',
      'set-list-image',
      'history',
      'diff',
      'get-primer',
      'remove-card',
      'set-card',
      'note',
      'move',
      'import-account',
      'import-changes',
      'export',
      'sell',
      'init-site',
      'login',
      'deck-sync',
      'collection-sync',
      'mcp',
      'skills',
      'cache',
      'cleanup',
      'self-update',
      'config',
      'doctor',
      'locale',
      'license',
      'migrate',
      'detect-changes',
      'list-all-cards',
      'dep-license',
    ])
  })

  test('the command groups appear in the documented order', () => {
    const headings: string[] = []
    for (const command of program.commands) {
      const heading = command.helpGroup()
      if (headings.at(-1) !== heading) headings.push(heading)
    }
    expect(headings).toEqual([
      t('help.group.start'),
      t('help.group.browse'),
      t('help.group.publish'),
      t('help.group.lists'),
      t('help.group.cards'),
      t('help.group.importExport'),
      t('help.group.lookupPricing'),
      t('help.group.site'),
      t('help.group.integrations'),
      t('help.group.cache'),
      t('help.group.utilities'),
      t('help.group.advanced'),
    ])
  })
  /**
   * Commander copies exitOverride / help / output configuration into a
   * subcommand at creation, so buildProgram must install them before it runs
   * the registrars. A registrar-created subcommand is the probe.
   */
  test('subcommands inherit exitOverride and the localized help/error hooks', () => {
    const sub = probeCommand(() => undefined)
    expect(sub.createHelp().styleTitle).toBe(localizeHelpTitle)
    expect(() => sub.parent!.parse(['probe', '--bogus'], { from: 'user' })).toThrow(CommanderError)
  })
})

/**
 * The localizer falls through verbatim when no rule matches, so a broken regex
 * would only ever show up as English in a translated run. Each sample must be
 * claimed by a rule AND round-trip through the English catalog unchanged.
 */
describe('localizeCommanderError', () => {
  const samples = [
    "error: unknown option '--bogus'",
    "error: unknown command 'dif'",
    "error: missing required argument 'name'",
    "error: option '--set <code>' argument missing",
    "error: required option '--type <type>' not specified",
    'error: too many arguments. Expected 1 argument but got 2: a b.',
  ]
  for (const raw of samples) {
    test(`claims and round-trips ${JSON.stringify(raw)}`, () => {
      expect(COMMANDER_ERROR_RULES.some((rule) => rule.pattern.test(raw))).toBe(true)
      expect(localizeCommanderError(raw)).toBe(raw)
    })
  }

  test('passes an unrecognised message through untouched', () => {
    expect(localizeCommanderError('error: something new')).toBe('error: something new')
  })

  /**
   * What Commander itself prints for a value `.choices()` refuses — generated
   * from the library rather than pasted in, so a rewording in a Commander
   * upgrade fails here instead of silently falling through to English.
   */
  function commanderChoicesRefusal(choices: string[]): string {
    let written = ''
    const command = new Command()
      .exitOverride()
      .configureOutput({ writeErr: (text) => (written += text) })
      .addOption(new Option('--transport <type>').choices(choices))
    expect(() => command.parse(['--transport', 'foo'], { from: 'user' })).toThrow(CommanderError)
    return written.replace(/\n$/, '')
  }

  test("claims and round-trips Commander's .choices() refusal in English", () => {
    const refusal = commanderChoicesRefusal(['stdio', 'http'])
    expect(refusal).toBe(
      "error: option '--transport <type>' argument 'foo' is invalid. Allowed choices are stdio, http.",
    )
    expect(localizeCommanderError(refusal)).toBe(refusal)
  })

  test(".choices()'s reason is the catalog's under the pseudo-locale, its choices verbatim", () => {
    const refusal = commanderChoicesRefusal(['stdio', 'http'])
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      const localized = localizeCommanderError(refusal)
      const frame = pseudoString('help.commander.invalidOptionArgument')
        .replace('{flags}', '--transport <type>')
        .replace('{value}', 'foo')
      const reason = pseudoString('help.commander.allowedChoices').replace(
        '{choices}',
        'stdio, http',
      )
      expect(localized).toBe(`${frame} ${reason}`)
      expect(localized).not.toContain('Allowed choices')
      expect(localized).not.toContain('is invalid')
    })
  })

  test(".choices()'s values are joined the way the reader's language lists them", () => {
    const refusal = commanderChoicesRefusal(['a', 'b', 'c'])
    // German with no dictionary: the words stay English, the join is German.
    withSyntheticLocale('de', {}, () => {
      expect(localizeCommanderError(refusal)).toEndWith(' Allowed choices are a, b und c.')
    })
  })

  test("a validator's own reason is still carried through as-is", () => {
    withSyntheticLocale('en-XA', pseudoCatalog(), () => {
      const localized = localizeCommanderError(
        "error: option '--limit <n>' argument '0' is invalid. Must be positive.",
      )
      expect(localized).toEndWith(' Must be positive.')
    })
  })
})

/**
 * Commander's `(choices: …, default: …)` help annotations, rebuilt from the
 * catalog: byte-identical to the library's in English, translated words around
 * verbatim values otherwise.
 */
describe('localized help annotations', () => {
  const transport = new Option('--transport <type>', 'Transport to use')
    .choices(['stdio', 'http'])
    .default('stdio')

  test("every option and argument of the real tree matches Commander's own English", () => {
    const help = new Command().createHelp()
    let compared = 0
    let booleanDefaults = 0
    const walk = (command: Command): void => {
      for (const option of command.options) {
        if (option.isBoolean() && typeof option.defaultValue === 'boolean') {
          // The one deliberate difference: a switch's `(default: false)` is dropped.
          expect(localizedOptionDescription(option)).toBe(option.description)
          booleanDefaults += 1
        } else {
          expect(localizedOptionDescription(option)).toBe(help.optionDescription(option))
        }
        compared += 1
      }
      for (const argument of command.registeredArguments) {
        expect(localizedArgumentDescription(argument)).toBe(help.argumentDescription(argument))
        compared += 1
      }
      for (const sub of command.commands) walk(sub)
    }
    walk(realProgram())
    // Vacuity guard: the tree has hundreds of rows, annotated ones among them,
    // and `--quiet` alone gives it boolean defaults to drop.
    expect(compared).toBeGreaterThan(200)
    expect(booleanDefaults).toBeGreaterThan(0)
  })

  test('so do the annotations no Ritual option uses yet', () => {
    // Commander's preset, env and argument-choices notes take the same path.
    const help = new Command().createHelp()
    const preset = new Option('--level [n]', 'Level').preset('3')
    const env = new Option('--token <secret>', 'Token').env('RITUAL_TOKEN')
    for (const option of [preset, env]) {
      expect(localizedOptionDescription(option)).toBe(help.optionDescription(option))
    }
    const argument = new Argument('[mode]', 'Mode').choices(['a', 'b']).default('a')
    expect(localizedArgumentDescription(argument)).toBe(help.argumentDescription(argument))
  })

  test("are the catalog's under the pseudo-locale, the values verbatim", () => {
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      const choices = pseudoString('help.commander.annotationChoices').replace(
        '{choices}',
        '"stdio", "http"',
      )
      const fallback = pseudoString('help.commander.annotationDefault').replace(
        '{value}',
        '"stdio"',
      )
      expect(localizedOptionDescription(transport)).toBe(
        `Transport to use ${pseudoString('help.commander.annotations').replace(
          '{annotations}',
          `${choices}, ${fallback}`,
        )}`,
      )
    })
  })

  test("join the values and the notes the way the reader's language lists them", () => {
    const mode = new Option('--mode <m>', 'Mode').choices(['a', 'b', 'c']).default('a')
    withSyntheticLocale('de', {}, () => {
      expect(localizedOptionDescription(mode)).toBe(
        'Mode (choices: "a", "b" und "c", default: "a")',
      )
    })
  })

  test('a real help page carries them through configureHelp', () => {
    const sub = probeCommand((probe) => {
      probe.addOption(transport)
    })
    withSyntheticLocale('en-XA', pseudoCatalog(), () => {
      const help = sub.helpInformation()
      expect(help).toContain('"stdio"')
      expect(help).not.toContain('choices:')
      expect(help).not.toContain('default:')
    })
  })
})

/**
 * Commander hands `styleTitle` its own English headings; each one this hook
 * claims must come back in the reader's language, and anything else (Ritual's
 * own command-group headings, already localized) must pass through untouched.
 */
describe('localizeHelpTitle', () => {
  test.each(['Usage:', 'Arguments:', 'Options:', 'Commands:'])(
    'relabels Commander’s %p under the pseudo-locale',
    (title) => {
      withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
        expectLocaleInForce(locale)
        const localized = localizeHelpTitle(title)
        expect(localized).not.toBe(title)
        expect(localized).toMatch(/^\[.*\]$/)
      })
    },
  )

  test('passes a heading it does not claim through verbatim', () => {
    withSyntheticLocale('en-XA', pseudoCatalog(), () => {
      expect(localizeHelpTitle('Ein Titel:')).toBe('Ein Titel:')
    })
  })

  test('a real subcommand’s help keeps none of Commander’s English headings', () => {
    const sub = probeCommand((probe) => {
      probe.argument('<name>').option('--flag')
    })
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      const help = sub.helpInformation()
      expect(help).toContain('--flag')
      for (const heading of ['Usage:', 'Arguments:', 'Options:']) {
        expect(help).not.toContain(heading)
      }
    })
  })
})

/**
 * `ritual --help` describes the core tier, only names the `more` tier, and
 * leaves the advanced tier to `help --all`. Probed with a three-group tree so
 * the assertions do not restate the real registry.
 */
describe('tiered root help', () => {
  const register =
    (name: string) =>
    (root: Command): void => {
      root
        .command(name)
        .description(`${name} summary`)
        .action(() => undefined)
    }
  const groups: readonly CommandGroup[] = [
    { titleKey: 'help.group.start', tier: 'core', commands: [register('alpha')] },
    { titleKey: 'help.group.lists', tier: 'more', commands: [register('beta'), register('gamma')] },
    { titleKey: 'help.group.advanced', tier: 'advanced', commands: [register('delta')] },
  ]
  const rootHelp = (fullHelp: boolean): string =>
    buildProgram({
      groups,
      backfill: () => false,
      workspaceCheck: () => Promise.resolve(),
      updateNotice: NO_UPDATE_NOTICE,
      fullHelp,
    }).helpInformation()

  test('the condensed view describes core commands and only names the rest', () => {
    const help = rootHelp(false)
    expect(help).toContain(t('help.group.start'))
    expect(help).toContain('alpha summary')
    expect(help).not.toContain('beta summary')
    expect(help).toContain(t('help.tier.moreTitle'))
    expect(help).toMatch(/^ {2}beta, gamma$/m)
    expect(help).not.toContain('delta')
    expect(help).not.toContain(t('help.group.advanced'))
    expect(help).toContain('ritual help --all')
  })

  test('the full view describes every command under its group, advanced included', () => {
    const help = rootHelp(true)
    for (const name of ['alpha', 'beta', 'gamma', 'delta']) {
      expect(help).toContain(`${name} summary`)
    }
    expect(help).toContain(t('help.group.advanced'))
    expect(help).not.toContain(t('help.tier.moreTitle'))
  })

  test('a subcommand’s help is never condensed', () => {
    const program = buildProgram({
      groups: [
        {
          titleKey: 'help.group.start',
          tier: 'core',
          commands: [
            (root) => {
              const parent = root.command('parent')
              parent.command('child').description('child summary')
            },
          ],
        },
      ],
      backfill: () => false,
      workspaceCheck: () => Promise.resolve(),
      updateNotice: NO_UPDATE_NOTICE,
    })
    expect(program.commands[0]!.helpInformation()).not.toContain(t('help.tier.moreTitle'))
  })

  test('an unknown command is still offered a non-core command as its suggestion', () => {
    let written = ''
    const program = buildProgram({
      groups,
      backfill: () => false,
      workspaceCheck: () => Promise.resolve(),
      updateNotice: NO_UPDATE_NOTICE,
    })
    program.configureOutput({ writeErr: (text) => (written += text) })
    expect(() => program.parse(['gamm'], { from: 'user' })).toThrow(CommanderError)
    expect(written).toContain('gamma')
  })
})

describe('requestsFullHelp', () => {
  test.each([
    [['--help', '--all'], true],
    [['help', '--all'], true],
    [['--help'], false],
    [['add-card', 'x', '--', '--all'], false],
  ] as const)('%p -> %p', (argv, expected) => {
    expect(requestsFullHelp(argv)).toBe(expected)
  })
})
