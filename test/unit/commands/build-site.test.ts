import { describe, expect, test } from 'bun:test'
import { Command } from 'commander'
import { registerBuildSiteCommand } from '../../../src/commands/build-site'

describe('build-site command registration', () => {
  test('registers variadic decks argument', () => {
    const program = new Command()
    registerBuildSiteCommand(program)
    const buildSiteCommand = program.commands.find((command) => command.name() === 'build-site')

    expect(buildSiteCommand).toBeDefined()
    expect(buildSiteCommand?.registeredArguments).toHaveLength(1)
    expect(buildSiteCommand?.registeredArguments[0]?.name()).toBe('decks')
    expect(buildSiteCommand?.registeredArguments[0]?.variadic).toBeTrue()
    expect(buildSiteCommand?.registeredArguments[0]?.required).toBeFalse()
  })

  test('registers cache-images option', () => {
    const program = new Command()
    registerBuildSiteCommand(program)
    const buildSiteCommand = program.commands.find((command) => command.name() === 'build-site')

    const hasOption = Boolean(
      buildSiteCommand?.options.some((option) => option.long === '--cache-images'),
    )
    expect(hasOption).toBeTrue()
  })
})
