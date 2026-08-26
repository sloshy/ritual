import { describe, expect, test } from 'bun:test'
import { CommanderError } from 'commander'
import {
  buildProgram,
  COMMANDER_ERROR_RULES,
  localizeCommanderError,
  localizeHelpTitle,
} from '../../../src/cli/program'
import { COMMAND_GROUPS } from '../../../src/commands/registry'
import { COMMANDS_WITH_ID_BACKFILL } from '../../../src/commands/id-backfill'
import { registerCliMessages } from '../../../src/i18n/register/cli'
import { t } from '../../../src/i18n/t'

/**
 * The backfill allowlist and the command registry are maintained by hand in two
 * files; an entry naming a command that is not registered would silently never
 * backfill. Qualified names (`deck-sync pull`) resolve through the subcommand.
 */
describe('buildProgram', () => {
  registerCliMessages()
  const program = buildProgram({ groups: COMMAND_GROUPS, backfill: () => false })

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
      'lists',
      'new',
      'rename',
      'delete',
      'edit',
      'metadata',
      'set-list-image',
      'history',
      'diff',
      'get-primer',
      'add-card',
      'remove-card',
      'set-card',
      'note',
      'move',
      'import',
      'import-account',
      'import-changes',
      'export',
      'card',
      'scry',
      'price',
      'sell',
      'build-site',
      'serve',
      'init-site',
      'admin',
      'login',
      'deck-sync',
      'collection-sync',
      'mcp',
      'skills',
      'cache',
      'cleanup',
      'detect-changes',
      'list-all-cards',
      'config',
      'locale',
      'license',
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
      t('help.group.lists'),
      t('help.group.cards'),
      t('help.group.importExport'),
      t('help.group.lookupPricing'),
      t('help.group.site'),
      t('help.group.integrations'),
      t('help.group.cache'),
      t('help.group.utilities'),
      t('help.group.legal'),
    ])
  })
  /**
   * Commander copies exitOverride / help / output configuration into a
   * subcommand at creation, so buildProgram must install them before it runs
   * the registrars. A registrar-created subcommand is the probe.
   */
  test('subcommands inherit exitOverride and the localized help/error hooks', () => {
    const probe = buildProgram({
      groups: [
        {
          titleKey: 'help.group.utilities',
          commands: [
            (program) => {
              program.command('probe').action(() => undefined)
            },
          ],
        },
      ],
      backfill: () => false,
    })
    const sub = probe.commands.find((command) => command.name() === 'probe')
    expect(sub).toBeDefined()
    expect(sub!.createHelp().styleTitle).toBe(localizeHelpTitle)
    expect(() => probe.parse(['probe', '--bogus'], { from: 'user' })).toThrow(CommanderError)
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
})
