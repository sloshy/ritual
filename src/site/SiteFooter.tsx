import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import type { SourceOffer } from '../config/source-offer'
import { LinkedMessage } from '../ui/LinkedMessage'
import { useI18n } from '../ui/i18n'

const FAN_CONTENT_POLICY_URL = 'https://company.wizards.com/en/legal/fancontentpolicy'
const SCRYFALL_URL = 'https://scryfall.com'

type SiteFooterProps = {
  /** The Ritual that built or serves the site; null until a valid `index.json` arrives. */
  about: SourceOffer | null
}

/**
 * The public site's footer. First the source offer (AGPL §13): the Ritual
 * version that built the site, its license, and a link to that version's
 * source, all from `index.json`'s `about`. Then the statements every published
 * site owes: Wizards of the Coast's Fan Content Policy notice (the site shows
 * Magic card names, text and images) and credit to Scryfall, where the card
 * data and images come from. The docs site's footer
 * (docs-site/src/components/Footer.astro) says the same about Ritual itself.
 */
export const SiteFooter: Component<SiteFooterProps> = (props) => {
  const { t, tSegments } = useI18n()
  return (
    <footer class="site-footer">
      <Show when={props.about}>
        {(about) => (
          <p>
            <LinkedMessage
              segments={tSegments('site.app.sourceOffer', {
                tool: 'ritual',
                version: about().version,
                license: about().license,
                source: t('site.app.sourceLink'),
              })}
              hrefs={{ tool: about().sourceUrl, source: about().revisionUrl }}
            />
          </p>
        )}
      </Show>
      <p class="site-footer-legal">
        <LinkedMessage
          segments={tSegments('site.app.fanContent', { policy: t('site.app.fanContentPolicy') })}
          hrefs={{ policy: FAN_CONTENT_POLICY_URL }}
        />
      </p>
      <p class="site-footer-legal">
        <LinkedMessage
          segments={tSegments('site.app.cardData', { scryfall: t('site.app.scryfallLink') })}
          hrefs={{ scryfall: SCRYFALL_URL }}
        />
      </p>
    </footer>
  )
}
