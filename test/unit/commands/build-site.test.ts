import { describe, expect, test } from 'bun:test'
import { Command } from 'commander'
import { registerBuildSiteCommand } from '../../../src/commands/build-site'

describe('build-site command registration', () => {
  test('registers --decks option', () => {
    const program = new Command()
    registerBuildSiteCommand(program)
    const buildSiteCommand = program.commands.find((command) => command.name() === 'build-site')

    expect(buildSiteCommand).toBeDefined()
    expect(buildSiteCommand?.registeredArguments).toHaveLength(0)
    const decksOption = buildSiteCommand?.options.find((option) => option.long === '--decks')
    expect(decksOption).toBeDefined()
    expect(decksOption?.variadic).toBeTrue()
    expect(decksOption?.required).toBeFalse()
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

  test('registers --collections option', () => {
    const program = new Command()
    registerBuildSiteCommand(program)
    const buildSiteCommand = program.commands.find((command) => command.name() === 'build-site')

    const collectionsOption = buildSiteCommand?.options.find(
      (option) => option.long === '--collections',
    )
    expect(collectionsOption).toBeDefined()
    expect(collectionsOption?.variadic).toBeTrue()
    expect(collectionsOption?.required).toBeFalse()
  })

  test('registers --collection-sort option', () => {
    const program = new Command()
    registerBuildSiteCommand(program)
    const buildSiteCommand = program.commands.find((command) => command.name() === 'build-site')

    const option = buildSiteCommand?.options.find((o) => o.long === '--collection-sort')
    expect(option).toBeDefined()
    expect(option?.required).toBeTrue()
  })

  test('registers --deck-sort option', () => {
    const program = new Command()
    registerBuildSiteCommand(program)
    const buildSiteCommand = program.commands.find((command) => command.name() === 'build-site')

    const option = buildSiteCommand?.options.find((o) => o.long === '--deck-sort')
    expect(option).toBeDefined()
    expect(option?.required).toBeTrue()
  })

  test('registers --currencies option', () => {
    const program = new Command()
    registerBuildSiteCommand(program)
    const buildSiteCommand = program.commands.find((command) => command.name() === 'build-site')

    const option = buildSiteCommand?.options.find((o) => o.long === '--currencies')
    expect(option).toBeDefined()
    expect(option?.required).toBeTrue()
  })
})
