import type { Component } from 'solid-js'
import type { SourceOffer } from '../../../config/source-offer'
import { LinkedMessage } from '../../../ui/LinkedMessage'
import { useI18n } from '../../../ui/i18n'

/** The docs page holding the license, the Fan Content Policy notice and the data credits. */
const ATTRIBUTION_URL = 'https://ritual.rpeters.dev/attribution/'

type AdminAboutProps = {
  about: SourceOffer
}

/**
 * The source offer at the foot of the admin's navigation (AGPL §13): the
 * running version, a link to that version's source, the license, and the
 * attribution page. The data comes from `GET /api/status`.
 */
export const AdminAbout: Component<AdminAboutProps> = (props) => {
  const { t, tSegments } = useI18n()
  return (
    <div class="admin-about">
      <p>
        <LinkedMessage
          segments={tSegments('admin.layout.about', {
            version: props.about.version,
            license: props.about.license,
            source: t('admin.layout.sourceLink'),
          })}
          hrefs={{ source: props.about.revisionUrl }}
        />
      </p>
      <p>
        <a href={ATTRIBUTION_URL} target="_blank" rel="noopener noreferrer">
          {t('admin.layout.attribution')}
        </a>
      </p>
    </div>
  )
}
