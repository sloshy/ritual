import { describe, expect, test } from 'bun:test'
import { joinTwoWordType } from '../../../src/commands/new'

describe('joinTwoWordType', () => {
  test.each([
    ['wanted', ['list', 'Grails'], 'wanted list', ['Grails']],
    ['Wanted', ['Lists', 'My', 'Grails'], 'Wanted Lists', ['My', 'Grails']],
    // Nothing after `list`: it is the name, not part of the type.
    ['wanted', ['list'], 'wanted', ['list']],
    // A quoted name arrives as one word and is never split.
    ['wanted', ['List of Grails'], 'wanted', ['List of Grails']],
    ['deck', ['list', 'Grails'], 'deck', ['list', 'Grails']],
  ] as const)('%p %p → %p %p', (rawType, nameParts, type, name) => {
    expect(joinTwoWordType(rawType, nameParts)).toEqual({ rawType: type, nameParts: [...name] })
  })
})
