import { describe, expect, test } from 'bun:test'
import type WebTorrent from 'webtorrent'
import fs from 'node:fs/promises'
import path from 'node:path'
import { FeedSeeder } from '../../src/cache-feed/seeder'
import { createFileTorrent } from '../../src/cache-feed/torrents'
import { syncMessage } from '../../src/sync/message'
import { t } from '../../src/i18n/t'
import { gzipJsonLines } from '../test-utils'
import { createWorkspace, removeWorkspace } from '../helpers/workspace'
import { pseudoCatalog, rejectedSyncMessage, withGuardedLocaleAsync } from '../helpers/sync-text'

/** The `on` a {@link neverReady} torrent is given: drop-only, so loosely typed. */
type TorrentOn = (event: string, listener: (...args: unknown[]) => void) => unknown

/**
 * Make `sync()` deaf to 'ready': every torrent the seeder's started client adds
 * drops its 'ready' listeners. The real client still adds, removes and tears
 * down; only the signal the timeout waits on is withheld.
 */
function neverReady(seeder: FeedSeeder): void {
  const client = (seeder as unknown as { client: WebTorrent | null }).client
  if (!client) throw new Error('neverReady: call seeder.start() first')
  const add = client.add.bind(client)
  client.add = (...args: Parameters<typeof add>) => {
    const torrent = add(...args)
    const on = torrent.on.bind(torrent) as TorrentOn
    ;(torrent as unknown as { on: TorrentOn }).on = (event, listener) =>
      event === 'ready' ? torrent : on(event, listener)
    return torrent
  }
}

describe('FeedSeeder', () => {
  test('sync before start is an internal error worded through the catalog', async () => {
    const seeder = new FeedSeeder({ filesDir: '/nonexistent', log: () => {} })
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(seeder.sync([])).rejects.toThrow(
      t('errors.invariant.calledBeforeSetup', { method: 'FeedSeeder.sync', setup: 'start()' }),
    )
  })

  test('a torrent that does not verify in time fails keyed, its message English', async () => {
    const dir = await createWorkspace({ dirs: [], config: false })
    const seeder = new FeedSeeder({ filesDir: dir, readyTimeoutMs: 50, log: () => {} })
    try {
      const filePath = path.join(dir, 'artifact.jsonl.gz')
      await fs.writeFile(filePath, gzipJsonLines([{ name: 'Sol Ring' }]))
      const torrent = await createFileTorrent(filePath, 'http://127.0.0.1:1/files/a', new Date(0))

      await seeder.start()
      // webtorrent emits 'ready' within milliseconds even for a missing or
      // corrupt artifact, so no on-disk setup holds it back, and a zero budget
      // only usually beat it (under load, 'ready' won). So sync() is made never
      // to hear 'ready', which leaves the timeout as the only way out.
      neverReady(seeder)
      const message = await withGuardedLocaleAsync('en-XA', pseudoCatalog(), () =>
        rejectedSyncMessage(seeder.sync([{ infoHash: torrent.infoHash, buffer: torrent.buffer }])),
      )
      expect(message).toEqual(
        syncMessage('cli.cacheFeed.torrentNotReady', { infoHash: torrent.infoHash }),
      )
    } finally {
      await seeder.stop()
      await removeWorkspace(dir)
    }
  }, 20_000)
})
