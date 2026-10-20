import { beforeAll, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Command } from 'commander'
import ts from 'typescript'
import { t } from '../../src/i18n/t'
import {
  COMMAND,
  commandLine,
  CONFIG_KEY,
  ENV_VAR,
  EXAMPLE,
  FILE,
  FLAG,
  flagValue,
  LINK,
} from '../../src/util/cli-tokens'
import { commandsByPath, realProgram } from '../helpers/program'
import { pseudoCatalog, withSyntheticLocale } from '../helpers/sync-text'

const REPO_ROOT = path.resolve(import.meta.dir, '../..')

/** A `--long-option` written anywhere in a help string. */
const FLAG_MENTION = /(?<![\w-])--[a-z][a-z0-9-]*/g

/** The long options `command` and every command above it declare. */
function optionsInScope(command: Command): Set<string> {
  const declared = new Set<string>()
  for (let at: Command | null = command; at; at = at.parent) {
    for (const option of at.options) if (option.long) declared.add(option.long)
  }
  return declared
}

/** Every `.ts` / `.tsx` file under `dir`, repo-relative, skipping generated code. */
function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(REPO_ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !file.includes('generated'))
    .map((file) => path.join(dir, file))
}

describe('the message tokens name what the program registers', () => {
  let commands: Map<string, Command>
  beforeAll(() => {
    commands = commandsByPath(realProgram())
  })

  test('every COMMAND is a registered command path', () => {
    const missing = Object.values(COMMAND)
      .map((commandPath) => commandPath.join(' '))
      .filter((commandPath) => !commands.has(commandPath))
    expect(missing).toEqual([])
  })

  // check-locales reads the top-level names off COMMAND to tell `ritual migrate`
  // from "a ritual process", so the list must be complete.
  test('COMMAND lists every registered top-level command', () => {
    const listed = new Set<string>(
      Object.values(COMMAND)
        .filter((commandPath) => commandPath.length === 1)
        .map((commandPath) => commandPath[0]),
    )
    const topLevel = [...commands.keys()].filter((name) => name !== '' && !name.includes(' '))
    expect(topLevel.filter((name) => !listed.has(name))).toEqual([])
  })

  test('every FLAG is a long option some command (or the root) declares', () => {
    const declared = new Set<string>()
    for (const command of commands.values()) {
      for (const option of command.options) if (option.long) declared.add(option.long)
    }
    const missing = Object.values(FLAG).filter((flag) => !declared.has(flag))
    expect(missing).toEqual([])
  })
})

/**
 * Help that names another flag must name one the reader can pass there: a
 * swapped param (`--set` help saying "requires --set") or a flag of another
 * command reads fine in English and is wrong.
 */
describe('help text names flags the command accepts', () => {
  /**
   * Help that deliberately points at another command's flag, by `command path
   * > option` (or `> description`) and the flag it names.
   */
  const CROSS_COMMAND: ReadonlySet<string> = new Set([
    // `build-site --out-dir`: "`serve` without --build serves it instead".
    'build-site > --out-dir > --build',
  ])

  let commands: Map<string, Command>
  beforeAll(() => {
    commands = commandsByPath(realProgram())
  })

  test('an option never names itself, and names only flags in its command’s scope', () => {
    const problems: string[] = []
    const allowed = new Set<string>()
    for (const [commandPath, command] of commands) {
      const scope = optionsInScope(command)
      const texts: [string, string, string | undefined][] = [
        ['description', command.description(), undefined],
        ...command.registeredArguments.map((argument): [string, string, string | undefined] => [
          `<${argument.name()}>`,
          argument.description,
          undefined,
        ]),
        ...command.options.map((option): [string, string, string | undefined] => [
          option.long ?? option.flags,
          option.description,
          option.long,
        ]),
      ]
      for (const [where, text, own] of texts) {
        for (const [mention] of text.matchAll(FLAG_MENTION)) {
          const site = `${commandPath} > ${where} > ${mention}`
          if (mention === own) problems.push(`${site}: names itself`)
          else if (CROSS_COMMAND.has(site)) allowed.add(site)
          else if (!scope.has(mention)) problems.push(`${site}: not an option here`)
        }
      }
    }
    expect(problems).toEqual([])
    // An exception the help no longer needs is deleted, not kept.
    expect([...CROSS_COMMAND].filter((site) => !allowed.has(site))).toEqual([])
  })
})

/**
 * Every `commandLine(COMMAND.x, FLAG.y …)` a message builds must be a command
 * line the program accepts: the flag declared on that command or above it.
 */
describe('command lines pair each command with its own flags', () => {
  type Pairing = { site: string; command: string; flags: string[] }

  /** Every `commandLine` / `bareCommandLine` call in src/, with the FLAG names it passes. */
  function pairings(): Pairing[] {
    const found: Pairing[] = []
    for (const file of sourceFiles('src')) {
      const source = readFileSync(path.join(REPO_ROOT, file), 'utf8')
      if (!source.includes('ommandLine(')) continue
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          /^(?:bare)?[cC]ommandLine$/.test(node.expression.text)
        ) {
          const [first, ...rest] = node.arguments
          const command = first?.getText(sourceFile).match(/^COMMAND\.(\w+)$/)?.[1]
          if (command !== undefined) {
            const flags = rest.flatMap((argument) =>
              [...argument.getText(sourceFile).matchAll(/\bFLAG\.(\w+)/g)].map((m) => m[1] ?? ''),
            )
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            found.push({ site: `${file}:${line + 1}`, command, flags })
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(sourceFile)
    }
    return found
  }

  test('every flag a command line passes is that command’s', () => {
    const commands = commandsByPath(realProgram())
    const found = pairings()
    expect(found.length).toBeGreaterThan(20)
    const problems: string[] = []
    for (const { site, command, flags } of found) {
      const commandPath = (COMMAND as Record<string, readonly string[]>)[command]?.join(' ')
      const registered = commandPath === undefined ? undefined : commands.get(commandPath)
      if (registered === undefined) {
        problems.push(`${site}: COMMAND.${command} is not registered`)
        continue
      }
      const scope = optionsInScope(registered)
      for (const flag of flags) {
        const spelled = (FLAG as Record<string, string>)[flag]
        if (spelled === undefined || !scope.has(spelled)) {
          problems.push(`${site}: ${commandPath} has no ${spelled ?? `FLAG.${flag}`}`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})

/**
 * A variable a message tells the user to set must be the one the code reads:
 * each ENV_VAR is read through the constant, so a rename moves both.
 */
describe('every ENV_VAR is read through its constant', () => {
  /**
   * Variables read indirectly: their name is handed to a reader rather than
   * indexed into `process.env` on the spot.
   */
  const INDIRECT_READS: Partial<Record<keyof typeof ENV_VAR, RegExp>> = {
    // `resolveRefreshMs` looks the variable up by the name it is given.
    cacheFeedRefresh: /resolveRefreshMs\([^)]*ENV_VAR\.cacheFeedRefresh\)/,
    // A GitHub Actions repository variable: the generated workflow reads it.
    version: /vars\.\$\{ENV_VAR\.version\}/,
  }

  const sources = [...sourceFiles('src'), ...sourceFiles('scripts')]
    .filter((file) => !file.endsWith('cli-tokens.ts') && !file.includes(`i18n${path.sep}messages`))
    .map((file) => readFileSync(path.join(REPO_ROOT, file), 'utf8'))
    .join('\n')

  test.each(Object.keys(ENV_VAR) as (keyof typeof ENV_VAR)[])('ENV_VAR.%s', (key) => {
    const read = INDIRECT_READS[key] ?? new RegExp(`\\[ENV_VAR\\.${key}\\]`)
    expect(sources).toMatch(read)
  })
})

/**
 * The point of passing tokens as params: under a translation — here the
 * en-XA pseudo-locale, which accents every letter it is given — the prose
 * changes and the token does not. One representative key per kind of token;
 * the other params are letter-free, so the tokens are the only plain ASCII
 * words left in the pseudo text.
 */
describe('a token passed as a param reaches the pseudo-locale verbatim', () => {
  const rows: [string, () => string, string[]][] = [
    ['a flag', () => t('cli.sync.refuseDecks', { cost: '…', flag: FLAG.yes }), ['--yes']],
    [
      'a flag and its value',
      () =>
        t('cli.scry.truncated', {
          fetched: 1,
          total: 2,
          pages: '1',
          flag: flagValue(FLAG.pages, '<n>'),
        }),
      ['--pages <n>'],
    ],
    [
      'a command line',
      () =>
        t('cli.migrate.notice.pending', {
          migrateDryRunCommand: commandLine(COMMAND.migrate, FLAG.dryRun),
          migrateCommand: commandLine(COMMAND.migrate),
        }),
      ['`ritual migrate --dry-run`', '`ritual migrate`'],
    ],
    [
      'an environment variable',
      () => t('cli.prompt.reason.noInput', { flag: FLAG.noInput, envVar: ENV_VAR.noInput }),
      ['--no-input', 'RITUAL_NO_INPUT'],
    ],
    [
      'a config key and a file name',
      () =>
        t('cli.locale.detectSaved', {
          configKey: CONFIG_KEY.uiLocale,
          locale: '…',
          file: FILE.config,
        }),
      ['uiLocale', 'ritual.config.json'],
    ],
    [
      'an example vocabulary',
      () => t('admin.importCsv.rowsHint', { count: 2, example: EXAMPLE.importNormalization }),
      ['“Near Mint” → NM, “F” → foil, “side” → Sideboard'],
    ],
    [
      'a URL',
      () => t('cli.cache.preloadSetNotFound', { set: '123', url: LINK.scryfallSets }),
      ['https://scryfall.com/sets'],
    ],
  ]

  test.each(rows)('%s', (_kind, render, tokens) => {
    const english = render()
    const pseudo = withSyntheticLocale('en-XA', pseudoCatalog(), render)
    expect(pseudo.startsWith('[')).toBe(true)
    expect(pseudo.endsWith(']')).toBe(true)
    let prose = pseudo
    for (const token of tokens) {
      expect(english).toContain(token)
      expect(pseudo).toContain(token)
      prose = prose.replaceAll(token, ' ')
    }
    // Everything but the tokens was accented: no English word survives.
    expect(prose).not.toMatch(/[A-Za-z]{2,}/)
  })
})
