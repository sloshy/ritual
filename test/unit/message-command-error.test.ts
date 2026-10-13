import { describe, expect, test } from 'bun:test'
import { apiMessage, plainMessage } from '../../src/api/result'
import { ExitCode, messageCommandError, type CardCommandError } from '../../src/util/errors'
import { withSyntheticLocale } from '../helpers/sync-text'

/**
 * A command that validates through an admin route's parser (or an engine that
 * builds a message) raises that refusal as a usage error. The route answers in
 * English; the CLI speaks its own language, so a keyed refusal is re-rendered in
 * the active locale and keeps its key for `--output json`.
 */
function apiRefusalError(refusal: Parameters<typeof messageCommandError>[2]): CardCommandError {
  return messageCommandError('usage_error', ExitCode.UsageError, refusal)
}

describe('messageCommandError', () => {
  test('re-renders a keyed refusal in the CLI’s locale and keeps its key', () => {
    const refusal = apiMessage('admin.api.metadata.sourceUrlInvalid')
    withSyntheticLocale('xx', { 'admin.api.metadata.sourceUrlInvalid': 'Schlechte URL' }, () => {
      const error = apiRefusalError(refusal)
      expect(error.message).toBe('Schlechte URL')
      expect(error.code).toBe('usage_error')
      expect(error.exitCode).toBe(ExitCode.UsageError)
      expect(error.messageRef).toEqual({ key: 'admin.api.metadata.sourceUrlInvalid' })
    })
  })

  test('carries the params a keyed refusal interpolates', () => {
    const params = { field: 'colour', fields: 'description, tags' }
    const refusal = apiMessage('admin.api.metadata.unknownField', params)
    withSyntheticLocale(
      'xx',
      { 'admin.api.metadata.unknownField': 'Feld {field}? Nur {fields}.' },
      () => {
        const error = apiRefusalError(refusal)
        expect(error.message).toBe('Feld colour? Nur description, tags.')
        expect(error.messageRef).toEqual({ key: 'admin.api.metadata.unknownField', params })
      },
    )
  })

  test('passes a refusal with no key through as it is', () => {
    const error = apiRefusalError(plainMessage('labels [sale] are not supported on a deck'))
    expect(error.message).toBe('labels [sale] are not supported on a deck')
    expect(error.messageRef).toBeUndefined()
  })
})
