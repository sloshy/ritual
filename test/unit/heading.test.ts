import { describe, test, expect } from 'bun:test'
import { headingName, sectionHeading, titleHeading } from '../../src/list/heading'

describe('headingName', () => {
  test('is what parseHeading reads back: folded, then trimmed', () => {
    expect(headingName('\n Burn \n')).toBe('Burn')
  })
})

describe('titleHeading / sectionHeading', () => {
  test('a title smuggling a card line stays one heading line', () => {
    expect(titleHeading('Burn\n1 Black Lotus &99')).toBe('# Burn 1 Black Lotus &99')
  })

  test('a section smuggling a header stays one heading line', () => {
    expect(sectionHeading('Main\n## Sideboard')).toBe('## Main ## Sideboard')
  })
})
