/**
 * The merged translator metadata for the English catalog. Every key in `en`
 * has an entry — the per-namespace `satisfies MetaFor<…>` checks make a missing
 * `description` a compile error — and the catalog validator reads this table to
 * enforce `maxLen` budgets and to emit translator templates.
 */

import type { MessageMeta } from '../types'
import { adminMeta } from './en/admin.meta'
import { cliMeta } from './en/cli.meta'
import { cliCardsMeta } from './en/cli-cards.meta'
import { cliEditMeta } from './en/cli-edit.meta'
import { cliInfraMeta } from './en/cli-infra.meta'
import { cliSyncMeta } from './en/cli-sync.meta'
import { domainMeta } from './en/domain.meta'
import { errorsMeta } from './en/errors.meta'
import { helpMeta } from './en/help.meta'
import { helpCardsMeta } from './en/help-cards.meta'
import { helpEditMeta } from './en/help-edit.meta'
import { helpInfraMeta } from './en/help-infra.meta'
import { helpSyncMeta } from './en/help-sync.meta'
import { siteMeta } from './en/site.meta'
import { siteCardsMeta } from './en/site-cards.meta'
import { siteChromeMeta } from './en/site-chrome.meta'
import { siteEditorMeta } from './en/site-editor.meta'
import { sitePagesMeta } from './en/site-pages.meta'
import { uiMeta } from './en/ui.meta'
import type { MessageKey } from './en'

/** Per-key description (and optional length budget) for every English message. */
export const enMeta: Record<MessageKey, MessageMeta> = {
  ...adminMeta,
  ...cliMeta,
  ...cliCardsMeta,
  ...cliEditMeta,
  ...cliInfraMeta,
  ...cliSyncMeta,
  ...domainMeta,
  ...errorsMeta,
  ...helpMeta,
  ...helpCardsMeta,
  ...helpEditMeta,
  ...helpInfraMeta,
  ...helpSyncMeta,
  ...siteMeta,
  ...siteCardsMeta,
  ...siteChromeMeta,
  ...siteEditorMeta,
  ...sitePagesMeta,
  ...uiMeta,
}
