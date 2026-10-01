import { describe, expect, test } from 'bun:test'
import { MAX_BODY_SIZE } from '../../../src/api/http'
import { MAX_QUOTE_BODY_BYTES } from '../../../src/api/buylist'
import { MAX_PRICE_BODY_BYTES } from '../../../src/api/card-prices'
import {
  MAX_ADMIN_REQUEST_BODY_SIZE,
  MAX_EDIT_BODY_SIZE,
  MAX_METADATA_BODY_SIZE,
  MAX_UPLOAD_BODY_SIZE,
} from '../../../src/admin/validation'
import { MAX_SITE_REQUEST_BODY_SIZE } from '../../../src/serve/server'
import { MAX_MCP_REQUEST_BODY_SIZE } from '../../../src/mcp/run'

/**
 * Each server's hard `maxRequestBodySize` must sit strictly above every route
 * budget it fronts. At or below one, the runtime answers a body just past that
 * budget with an empty 413 before the route can send its own JSON refusal — and
 * a ceiling below a budget would make the route's budget unreachable.
 */
describe('server body ceilings', () => {
  test.each([
    ['MAX_BODY_SIZE', MAX_BODY_SIZE],
    ['MAX_METADATA_BODY_SIZE', MAX_METADATA_BODY_SIZE],
    ['MAX_EDIT_BODY_SIZE', MAX_EDIT_BODY_SIZE],
    ['MAX_UPLOAD_BODY_SIZE', MAX_UPLOAD_BODY_SIZE],
  ])('the admin ceiling is above %s', (_name, budget) => {
    expect(MAX_ADMIN_REQUEST_BODY_SIZE).toBeGreaterThan(budget)
  })

  test.each([
    ['MAX_BODY_SIZE', MAX_BODY_SIZE],
    ['MAX_QUOTE_BODY_BYTES', MAX_QUOTE_BODY_BYTES],
    ['MAX_PRICE_BODY_BYTES', MAX_PRICE_BODY_BYTES],
  ])('the public-site ceiling is above %s', (_name, budget) => {
    expect(MAX_SITE_REQUEST_BODY_SIZE).toBeGreaterThan(budget)
  })

  // A file-sized tool argument arrives as an escaped JSON string inside the
  // JSON-RPC envelope, where quotes and newlines double.
  test('the MCP ceiling fits an upload-budget file escaped at double size', () => {
    expect(MAX_MCP_REQUEST_BODY_SIZE).toBeGreaterThanOrEqual(2 * MAX_UPLOAD_BODY_SIZE)
  })
})
