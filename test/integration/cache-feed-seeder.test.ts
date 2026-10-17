import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { FeedSeeder } from '../../src/cache-feed/seeder'
import { createFileTorrent } from '../../src/cache-feed/torrents'
import { syncMessage } from '../../src/sync/message'
import { t } from '../../src/i18n/t'
import { gzipJsonLines } from '../test-utils'
import { createWorkspace, removeWorkspace } from '../helpers/workspace'
import { pseudoCatalog, rejectedSyncMessage, withGuardedLocaleAsync } from '../helpers/sync-text'

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
    // A zero budget: the timer fires before webtorrent can verify anything.
    const seeder = new FeedSeeder({ filesDir: dir, readyTimeoutMs: 0, log: () => {} })
    try {
      const filePath = path.join(dir, 'artifact.jsonl.gz')
      await fs.writeFile(filePath, gzipJsonLines([{ name: 'Sol Ring' }]))
      const torrent = await createFileTorrent(filePath, 'http://127.0.0.1:1/files/a', new Date(0))

      await seeder.start()
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
