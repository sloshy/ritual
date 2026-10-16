/**
 * The tag and category shape rules in English, for the tool surface — English
 * by contract. Read straight from the English catalog the engines' refusals
 * are worded with, so what the input schemas advertise can never drift from
 * what they and the engines refuse.
 *
 * A leaf on purpose: both the input schemas (`schemas.ts`) and the output
 * schemas' shared fragments (`schema-defs.ts`) need these two strings, and
 * neither should load the other's import closure to get them.
 */

import { domainCardMessages } from '../i18n/messages/en/domain-card'

/** What a tag may hold, as the clause a refusal quotes. */
export const CARD_TAG_SHAPE_RULE = domainCardMessages['domain.card.tag.shapeRule']

/** What a category may hold, as the clause a refusal quotes. */
export const CARD_CATEGORY_SHAPE_RULE = domainCardMessages['domain.card.category.shapeRule']
