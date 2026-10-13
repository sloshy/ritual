/**
 * Message registration for the **public site** SPA.
 *
 * Four namespaces: `site` (its own chrome and pages), `ui` (the shared
 * `src/ui` / `src/editor` components), `domain` (the vocabulary all three
 * surfaces share, with its `domain-changes` fragment — the editors validate an
 * imported change bundle in the browser and word its refusal) and `errors`. Not `cli`/`help` — that boundary is the whole
 * point: those two namespaces are 49% of the catalog and no browser can reach
 * a single one of their keys.
 *
 * The import list *is* the bundle contents. `registerMessages` is what pulls
 * these fragments into the module graph, so adding one here adds its text to
 * `src/site/app.compiled.js`.
 */

import { domainMessages } from '../messages/en/domain'
import { domainChangesMessages } from '../messages/en/domain-changes'
import { errorMessages } from '../messages/en/errors'
import { siteMessages } from '../messages/en/site'
import { siteCardsMessages } from '../messages/en/site-cards'
import { siteChromeMessages } from '../messages/en/site-chrome'
import { siteEditorMessages } from '../messages/en/site-editor'
import { sitePagesMessages } from '../messages/en/site-pages'
import { uiMessages } from '../messages/en/ui'
import { registerMessages } from '../runtime'

/**
 * Register the namespaces the public site speaks. Called at module scope in
 * `src/site/app.tsx`, before the app renders.
 *
 * Also called by {@link registerAdminMessages}: the admin embeds the shared
 * `src/site/**` views (the list editors, the selection modal, the printing
 * pickers), so it renders `site.*` keys even though no `src/admin/**` file
 * names one directly.
 */
export function registerSiteMessages(): void {
  registerMessages(
    domainMessages,
    domainChangesMessages,
    errorMessages,
    siteMessages,
    siteCardsMessages,
    siteChromeMessages,
    siteEditorMessages,
    sitePagesMessages,
    uiMessages,
  )
}
