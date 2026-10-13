/** Translator metadata for {@link adminApiMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { adminApiMessages } from './admin-api'

export const adminApiMeta = {
  'admin.api.move.moved': {
    description:
      'Result of committing queued moves. {count} counts copies. Further clauses (how many were skipped, which notes were dropped) are appended after it.',
  },
  'admin.api.setup.tokenInvalid': {
    description:
      'Refusal when the first-run account form was submitted without the one-time setup token the server printed, or with a wrong one. `ritual admin` and `ritual admin setup` are command names and stay verbatim.',
  },
  'admin.api.list.created': {
    description:
      'Success alert after a list is created, one branch per list type. {name} is the title the user typed. Translate each branch as a whole sentence — do not assemble it from a verb plus a noun.',
  },
  'admin.api.list.renamed': {
    description:
      'Success alert after a list is renamed. {name} is the new title. One branch per list type; see admin.api.list.created.',
  },
  'admin.api.list.deleted': {
    description:
      'Success alert after a list is deleted. {name} is the title it had; {trash} is the workspace-relative trash folder (e.g. ".trash/2026-10-05T14-03-22Z-deck-Burn") its files were moved into. One branch per list type; see admin.api.list.created.',
  },
  'admin.api.save.saved': {
    description:
      'Success alert after an editor save. {count} is how many individual changes were written, {name} the list they were written to. Deliberately not a plural table: the English wording is fixed by the response MCP clients already read.',
  },
  'admin.api.save.artUnreconciled': {
    description:
      "Warning in an editor save's response when the list's (or a move destination's) <list>.art.json custom-art sidecar could not be read, so the &N ids the save freed or renumbered could not be re-filed. {reason} is untranslated engine prose naming the file and the parse failure. A warning, never a failure: the card lines were written correctly.",
  },
  'admin.api.save.lineBreak': {
    description:
      'Refusal (HTTP 400) when a list save or move request carries a string with a line break (newline, carriage return, or Unicode line separator) in its card data, which would otherwise write extra lines into the list file. {field} is the untranslated JSON path of the offending value, e.g. changes[2].cardName.',
  },
  'admin.api.save.categoriesUnreconciled': {
    description:
      "Warning in an editor save's response when the list's <list>.categories.json sidecar could not be read or written, so the save's category assignments were not recorded. {reason} is untranslated engine prose naming the file and the failure. A warning, never a failure: the card lines were written correctly.",
  },
  'admin.api.load.categoriesUnreadable': {
    description:
      'Warning on a list load body when the list’s <list>.categories.json sidecar exists but could not be read or parsed. {reason} is untranslated engine prose naming the file and the failure. The load still returns the list: bad categories block nothing.',
  },
  'admin.api.load.categoriesStaleNames': {
    description:
      'Warning on a list load body naming sidecar entries whose card the list no longer holds. {names} is a comma-joined list of stored card names. A read reports them and never removes them; the next save prunes them.',
  },
  'admin.api.art.set': {
    description:
      "Success alert after a card's custom art is set from the editor. {name} is the list's slug. The card is not named: card ids are internal, and the alert appears beside the card that was just edited.",
  },
  'admin.api.art.cleared': {
    description:
      "Success alert after a card's custom art is removed, so it shows its real printing again. {name} is the list's slug.",
  },
  'admin.api.buildSite.built': {
    description: 'Success alert after the public site finishes building and is published.',
  },
  'admin.api.buildSite.cancelled': {
    description:
      'Error body (HTTP 499) when the caller cancelled a site build part way; the published site was left untouched.',
  },
  'admin.api.cache.refreshed': {
    description: 'Success alert after the local Scryfall card cache is rebuilt from bulk data.',
  },
  'admin.api.history.saved': {
    description:
      'Success alert after a change log is rewritten. A "change set" is one timestamped group of change lines in a list’s .changes.md file.',
  },
  'admin.api.move.removed': {
    description:
      'Result of committing a batch of cross-list removals. {count} counts copies. Further clauses (how many were skipped) are appended after it.',
  },
  'admin.api.archidekt.loggedIn': {
    description:
      'Success alert after signing in to Archidekt. {username} is the account name Archidekt reported.',
  },
  'admin.api.archidekt.credentialsRequired': {
    description:
      'Refusal when the Archidekt sign-in form was submitted without a username or a password. Lowercase "username" and "password" name the request fields.',
  },
  'admin.api.deckSync.loginRequired': {
    description:
      'Why a deck sync run never started: no usable Archidekt token is stored. Shown in place of a run summary.',
  },
  'admin.api.deckSync.noDecks': {
    description:
      'Whole summary of a deck sync run that found nothing linked to Archidekt. **No final punctuation** — the renderer terminates the sentence.',
  },
  'admin.api.deckSync.previewed': {
    description:
      'First clause of a dry-run deck sync summary: how many decks the run would have synced. **No final punctuation**, and further clauses may be joined after it.',
  },
  'admin.api.deckSync.pulled': {
    description:
      'First clause of a summary for a run that applied Archidekt’s changes to local deck files. See admin.api.deckSync.previewed.',
  },
  'admin.api.deckSync.pushed': {
    description:
      'First clause of a summary for a run that sent local deck changes to Archidekt. See admin.api.deckSync.previewed.',
  },
  'admin.api.deckSync.skipped': {
    description:
      'Summary clause: decks the run stepped over (nothing to do, or excluded by a filter). **No final punctuation.**',
  },
  'admin.api.deckSync.failed': {
    description:
      'Summary clause: decks the run could not sync. Each deck’s own reason is listed separately. **No final punctuation.**',
  },
  'admin.api.deckSync.cancelled': {
    description:
      'Summary clause of a run the caller cancelled part way; {count} is how many decks it never started (they are reported as skipped). **No final punctuation.**',
  },
  'admin.api.collectionSync.loginRequired': {
    description:
      'Why a collection sync run never started: no usable Archidekt token is stored. Shown in place of a run summary.',
  },
  'admin.api.collectionSync.accountRequired': {
    description:
      'Why a collection sync run never started: a token is stored but predates recording which Archidekt account it belongs to, and a collection is fetched by account.',
  },
  'admin.api.collectionSync.noLists': {
    description:
      'Whole summary of a collection sync run that found no lists to sync. **No final punctuation** — the renderer terminates the sentence.',
  },
  'admin.api.collectionSync.totals': {
    description:
      'First clause of a collection sync summary: copies added and removed. {action} selects the tense/direction (previewed = dry run, pulled = Archidekt → local, pushed = local → Archidekt). The + and - are literal signs on the counts. **No final punctuation.**',
  },
  'admin.api.collectionSync.totalsInto': {
    description:
      'admin.api.collectionSync.totals for a pull that added cards, naming the list they landed in. {into} is a list name shown in quotes. **No final punctuation.**',
  },
  'admin.api.collectionSync.pending': {
    description:
      'Summary clause: copies written to a CSV file instead of being pushed, so they reach Archidekt only once a human imports that file. **No final punctuation.**',
  },
  'admin.api.collectionSync.filtered': {
    description:
      'Summary clause: copies the run’s change filter excluded. **No final punctuation.**',
  },
  'admin.api.collectionSync.ambiguous': {
    description:
      'Summary clause: removals that matched copies in more than one list, so the run could not tell which list should lose the card. **No final punctuation.**',
  },
  'admin.api.collectionSync.listsFailed': {
    description:
      'Summary clause: collection lists the run could not sync. **No final punctuation.**',
  },
  'admin.api.collectionSync.errors': {
    description:
      'Summary clause: failures of the run as a whole, as opposed to failures of one list. **No final punctuation.**',
  },
  'admin.api.collectionSync.cancelled': {
    description:
      'Summary clause of a run the caller cancelled part way; {count} is how many lists it never started (they are reported as skipped). **No final punctuation.**',
  },

  // ── Requests the server refuses before a route runs ───────────────────
  'admin.api.server.forbidden': {
    description:
      'Error body (HTTP 403) when the admin server refuses a request because of its IP or User-Agent allow/deny lists. The standard HTTP reason phrase; translate it as your language’s usual wording for "Forbidden".',
  },
  'admin.api.server.setupRequired': {
    description:
      'Error body (HTTP 403) when a signed-in route is called before the first admin account exists.',
  },
  'admin.api.server.unauthorized': {
    description:
      'Error body (HTTP 401) when a route needs a session and the request has none, or an expired one. The standard HTTP reason phrase.',
  },
  'admin.api.server.notFound': {
    description:
      'Error body (HTTP 404) for a path the admin server has no route or file for. The standard HTTP reason phrase.',
  },
  'admin.api.server.internalError': {
    description:
      'Error body (HTTP 500) when a request failed with an error the server did not expect. The details go to the server’s console, never to the client.',
  },

  // ── Sign-in ───────────────────────────────────────────────────────────
  'admin.api.login.rateLimited': {
    description:
      'Error body (HTTP 429) when sign-in is locked after too many failed attempts from one address. The response also says how many seconds the lock lasts.',
  },
  'admin.api.login.credentialsRequired': {
    description: 'Refusal when the sign-in request is missing its username or its password.',
  },
  'admin.api.login.inputTooLong': {
    description:
      'Refusal when a sign-in field is longer than allowed, or the two-factor code is not six digits.',
  },
  'admin.api.login.invalidCredentials': {
    description:
      'Refusal when the username or password is wrong. Deliberately does not say which of the two.',
  },
  'admin.api.login.totpRequired': {
    description:
      'Sign-in answer when the password was right but two-factor authentication (TOTP) is on and no code was sent. The login form then asks for the code.',
  },
  'admin.api.login.totpMisconfigured': {
    description:
      'Error body (HTTP 500) when two-factor authentication is on but its stored secret is missing, so no code can be checked.',
  },
  'admin.api.login.totpInvalid': {
    description: 'Refusal when the two-factor (TOTP) code sent with a sign-in is wrong or expired.',
  },

  // ── First-run account ─────────────────────────────────────────────────
  'admin.api.setup.userExists': {
    description:
      'Refusal (HTTP 409) of the first-run account form, or of creating the account from the command line, when an admin account already exists.',
  },
  'admin.api.setup.credentialsRequired': {
    description:
      'Refusal of the first-run account form without a username or a password. Lowercase "username" and "password" name the request fields.',
  },
  'admin.api.setup.usernameTooLong': {
    description:
      'Refusal of the first-run account form when the username is over the length limit.',
  },
  'admin.api.setup.passwordTooLong': {
    description:
      'Refusal of the first-run account form when the password is over the length limit.',
  },
  'admin.api.setup.passwordTooShort': {
    description:
      'Refusal of a new admin password that is shorter than the minimum. {count} is the minimum number of characters.',
  },
  'admin.api.setup.created': {
    description: 'Success body after the first-run form created the admin account.',
  },

  // ── Two-factor authentication ─────────────────────────────────────────
  'admin.api.totp.alreadyEnabled': {
    description:
      'Refusal (HTTP 409) to start two-factor (TOTP) setup when it is already on; it must be turned off before it can be set up again.',
  },
  'admin.api.totp.codeRequired': {
    description:
      'Refusal of a two-factor setup confirmation sent without a code. Lowercase "code" names the request field.',
  },
  'admin.api.totp.noPendingSetup': {
    description:
      'Refusal of a two-factor setup confirmation when no setup was started. /api/totp/setup is a route path and stays verbatim.',
  },
  'admin.api.totp.codeInvalid': {
    description:
      'Refusal of a two-factor setup confirmation whose code does not match the new secret.',
  },
  'admin.api.totp.enabled': {
    description: 'Success body after the two-factor (TOTP) code was confirmed and TOTP turned on.',
  },
  'admin.api.totp.notEnabled': {
    description: 'Refusal to turn two-factor (TOTP) off when it is not on.',
  },
  'admin.api.totp.disabled': {
    description: 'Success body after two-factor (TOTP) was turned off.',
  },

  // ── Addressing a list ─────────────────────────────────────────────────
  'admin.api.target.typeInvalid': {
    description:
      'Refusal when a route’s list-type path segment is absent or is not deck, collection or wanted.',
  },
  'admin.api.target.slugRequired': {
    description: 'Refusal when a route’s list path segment (the list’s file name) is empty.',
  },
  'admin.api.target.slugInvalid': {
    description:
      'Refusal when a route’s list path segment contains a path separator or a NUL byte, so it cannot name one list file.',
  },
  'admin.api.listNotFound': {
    description:
      'Error body (HTTP 404) when no list matches the name a request gave. {list} is that name as the request spelled it (sometimes with a type prefix, e.g. "collection:binder").',
  },
  'admin.api.listTypeInvalid': {
    description:
      'Refusal when a `type` query parameter is not deck, collection or wanted. {type} is the value sent.',
  },
  'admin.api.list.notFound': {
    description:
      'Error body (HTTP 404) when the list a route names does not exist. {slug} is the list’s file name. One branch per list type; translate each branch as a whole sentence.',
  },
  'admin.api.list.notFoundListRoute': {
    description:
      'admin.api.list.notFound on the list load routes, which add a pointer to the route listing every list. GET /api/lists is a route and stays verbatim; "slugs" are list file names.',
  },
  'admin.api.list.slugInvalid': {
    description:
      'Refusal when a list file name would point outside its list type’s folder. One branch per list type.',
  },
  'admin.api.list.nameRequired': {
    description:
      'Refusal to create a list without a name. One branch per list type; translate each as a whole sentence.',
  },
  'admin.api.list.newNameRequired': {
    description: 'Refusal to rename a list to an empty name. One branch per list type.',
  },
  'admin.api.list.confirmNameRequired': {
    description:
      'Refusal to delete a list when the request does not repeat the list’s name. "confirmName" is the request field and stays verbatim.',
  },

  // ── Loading a list ────────────────────────────────────────────────────
  'admin.api.load.limitInvalid': {
    description:
      'Refusal of a list load whose `limit` query parameter is not a whole number of one or more. {value} is the value sent.',
  },
  'admin.api.load.offsetInvalid': {
    description:
      'Refusal of a list load whose `offset` query parameter is not a whole number of zero or more. {value} is the value sent.',
  },
  'admin.api.cardIndex.listTypeInvalid': {
    description:
      'Refusal of a card-index query whose listType is not a list type. {value} is the value sent; {choices} is the comma-separated list of accepted values (deck, collection, wanted), which stay verbatim.',
  },
  'admin.api.cardIndex.slugInvalid': {
    description:
      'Refusal of a card-index query whose slug (a list file name) contains a path separator. {slug} is the value sent.',
  },

  // ── Saving a list ─────────────────────────────────────────────────────
  'admin.api.save.conflict': {
    description:
      'Error body (HTTP 409) when a list changed on disk after the editor loaded it, so the save was refused. One branch per list type.',
  },
  'admin.api.save.fieldsRequired': {
    description:
      'Refusal of a list save that lacks its changes or its contentHash, with the likely reason. changes, contentHash, "partial": true, section, nameContains, limit and offset are request/response fields and stay verbatim.',
  },
  'admin.api.save.frontMatterUnreadable': {
    description:
      'Refusal of a deck save when the YAML front matter at the top of the deck file cannot be parsed. {reason} is the parser’s untranslated description of the problem.',
  },
  'admin.api.save.frontMatterNotMapping': {
    description:
      'Refusal of a deck save when the deck file’s front matter parses but is not a key/value mapping. Same sentence as admin.api.save.frontMatterUnreadable with the reason filled in.',
  },
  'admin.api.save.idPastCeiling': {
    description:
      'Refusal of a list save whose change claims a card id far beyond what the save could need. {index} is the change’s position in the request, {id} the claimed id (shown after a literal "&", the card-line id marker) and {ceiling} the highest id the save could allocate.',
  },

  // ── The local card cache ──────────────────────────────────────────────
  'admin.api.cache.empty': {
    description:
      'Error body (HTTP 503) when a route that reads card data only from the local cache finds it empty. {need} selects what is missing: prices, or buylist matching. refresh_cache (an MCP tool) and `ritual cache preload-all` (a command) stay verbatim.',
  },
  'admin.api.cardNames.coldCache': {
    description:
      'Refusal of a write that asked for its card names to be checked (validateCardNames) while the local card cache is empty. refresh_cache, `ritual cache preload-all` and validateCardNames stay verbatim.',
  },
  'admin.api.cardNames.unknown': {
    description:
      'Refusal of a write that asked for its card names to be checked, for one name the card cache does not know. {name} is the name as sent.',
  },
  'admin.api.cardNames.unknownSuggested': {
    description:
      'admin.api.cardNames.unknown with the closest names the cache does know. {candidates} is a comma-separated list of card names.',
  },

  // ── Settings ──────────────────────────────────────────────────────────
  'admin.api.config.unknownKey': {
    description:
      'Refusal of a settings update naming a setting that does not exist. {key} is the untranslated config key sent.',
  },
  'admin.api.config.notString': {
    description:
      'Refusal of a settings update whose directory setting is not text. {key} is the untranslated config key.',
  },
  'admin.api.config.unknownAdminKey': {
    description:
      'Refusal of a settings update naming an admin-server setting that does not exist. {key} is the untranslated key sent.',
  },

  // ── Custom card art ───────────────────────────────────────────────────
  'admin.api.art.unknownField': {
    description:
      'Refusal of a custom-art request carrying a field it does not accept. {field} is the field sent; cardId and art are the accepted request fields and stay verbatim.',
  },
  'admin.api.art.cardIdInvalid': {
    description:
      'Refusal of a custom-art request whose cardId is not a positive whole number. "&N" is the literal card-line id marker; cardId stays verbatim.',
  },
  'admin.api.art.artRequired': {
    description:
      'Refusal of a custom-art request without its art field. art, "file", "url" and null are request vocabulary and stay verbatim.',
  },
  'admin.api.art.staleIds': {
    description:
      'Warning on a list load: the list’s custom-art file names card ids no line in the list has any more. {file} is the art file’s path; {ids} is a comma-separated list of card ids.',
  },
  'admin.api.art.listNotFound': {
    description:
      'Error body (HTTP 404) of a custom-art request naming a list that does not exist. {slug} is the list’s file name. One branch per list type.',
  },
  'admin.api.art.cardNotInList': {
    description:
      'Refusal of a custom-art request for a card id the list does not hold. {cardId} is the id; {slug} the list’s file name. One branch per list type.',
  },
  'admin.api.art.imageMissing': {
    description:
      'Refusal of a custom-art request naming an image file that does not exist. {path} is the full path that was checked.',
  },

  // ── List metadata ─────────────────────────────────────────────────────
  'admin.api.metadata.lastSyncedReadOnly': {
    description:
      'Refusal of a metadata write that tries to set lastSynced, which only deck sync writes. lastSynced stays verbatim.',
  },
  'admin.api.metadata.unknownField': {
    description:
      'Refusal of a metadata write naming a field the list type does not accept. {field} is the field sent; {fields} is the comma-separated list of accepted field names, which stay verbatim.',
  },
  'admin.api.metadata.tagsInvalid': {
    description:
      'Refusal of a deck metadata write whose tags field is not a list of text, or null.',
  },
  'admin.api.metadata.tagsBlank': {
    description: 'Refusal of a deck metadata write whose tags include an empty one.',
  },
  'admin.api.metadata.sourceIdInvalid': {
    description:
      'Refusal of a deck metadata write whose sourceId (the deck’s id on the site it came from) is empty or not text.',
  },
  'admin.api.metadata.sourceUrlInvalid': {
    description:
      'Refusal of a deck metadata write whose sourceUrl is not a web address starting with http:// or https://.',
  },

  // ── Moving and removing cards ─────────────────────────────────────────
  'admin.api.move.movesRequired': {
    description: 'Refusal of a move request without its moves list. "moves" is the request field.',
  },
  'admin.api.move.invalidMove': {
    description:
      'Refusal of a move request when one of its moves is missing a field or has a wrong one.',
  },
  'admin.api.move.removesRequired': {
    description:
      'Refusal of a removal request without its removes list. "removes" is the request field.',
  },
  'admin.api.move.invalidRemove': {
    description:
      'Refusal of a removal request when one of its removals is missing a field or has a wrong one.',
  },
  'admin.api.move.toSectionDeckOnly': {
    description:
      'Refusal of a move that names a deck section (toSection) while its destination is a collection or a wanted list, which have no sections. toSection stays verbatim.',
  },

  // ── Comparing lists ───────────────────────────────────────────────────
  'admin.api.diff.sidesRequired': {
    description:
      'Refusal of a list comparison without its two lists. a and b are query parameter names; "[type:]name" shows their format (an optional list-type prefix, then a list name) and stays verbatim.',
  },

  // ── Prices and the sell report ────────────────────────────────────────
  'admin.api.sell.refInvalid': {
    description:
      'Refusal of a sell-report query whose lists parameter holds an entry not shaped type:slug. {ref} is the entry sent; "type:slug" is the format and stays verbatim.',
  },
  'admin.api.sell.noRefs': {
    description:
      "Refusal of a sell-report query whose lists parameter was given but names no list. 'lists' is the query parameter and stays verbatim.",
  },

  // ── Export ────────────────────────────────────────────────────────────
  'admin.api.field.notBoolean': {
    description:
      'Refusal of a request whose {field} (an untranslated request field, e.g. dryRun, overwrite or validateCardNames) is not true or false.',
  },
  'admin.api.field.notString': {
    description:
      'Refusal of a request whose {field} (an untranslated request field, e.g. name, filters.name or contentHash) is not text.',
  },
  'admin.api.export.columnsNotArray': {
    description: 'Refusal of an export request whose columns field is not a list of column names.',
  },
  'admin.api.export.filtersNotObject': {
    description: 'Refusal of an export request whose filters field is not an object.',
  },
  'admin.api.export.conditionsNotArray': {
    description:
      'Refusal of an export request whose condition filter is not a list. filters.conditions is the request field.',
  },
  'admin.api.export.labelsNotArray': {
    description:
      'Refusal of an export request whose label filter is not a list. filters.labels is the request field.',
  },
  'admin.api.export.presetUnknown': {
    description:
      'Refusal of an export request naming a preset that does not exist. {name} is the preset sent; {presets} is a comma-separated list of the preset names that do.',
  },
  'admin.api.export.cardsInvalid': {
    description:
      'Refusal of an export request whose cards field is not a list of card search text.',
  },
  'admin.api.export.listsNotArray': {
    description:
      'Refusal of an export request whose lists field is not a list. {shape} is the untranslated JSON shape each entry must have, e.g. "{ type?, name }".',
  },
  'admin.api.export.listNameMissing': {
    description: 'Refusal of an export request with a list entry that has no name.',
  },
  'admin.api.export.listTypeInvalid': {
    description:
      'Refusal of an export request with a list entry whose type is not deck, collection or wanted. {type} is the value sent.',
  },

  // ── Change history ────────────────────────────────────────────────────
  'admin.api.history.setsRequired': {
    description:
      'Refusal of a change-history rewrite without its sets list. A "change set" is one timestamped group of change lines in a list’s .changes.md file; "sets" is the request field.',
  },
  'admin.api.history.setNotObject': {
    description:
      'Refusal of a change-history rewrite whose sets list holds something other than a change set.',
  },
  'admin.api.history.timestampInvalid': {
    description:
      'Refusal of a change-history rewrite with a change set whose timestamp is not a valid ISO-8601 date and time.',
  },
  'admin.api.history.linesInvalid': {
    description:
      'Refusal of a change-history rewrite with a change set whose lines field is not a list of text.',
  },
  'admin.api.history.linesEmpty': {
    description: 'Refusal of a change-history rewrite with a change set that has no change lines.',
  },
  'admin.api.history.lineInvalid': {
    description:
      'Refusal of a change-history rewrite with a change line that does not start with a dash and a space ("- "), or that spans several lines. "- " is literal.',
  },
  'admin.api.history.eventsMissing': {
    description:
      'Refusal of a change-history rewrite with a change set that has no events list (the machine-readable record of its changes).',
  },
  'admin.api.history.eventInvalid': {
    description:
      'Refusal of a change-history rewrite with an unreadable change event. {set} and {event} are 1-based positions; {problem} is untranslated engine prose that begins with a verb phrase, e.g. is missing its "id".',
  },
  'admin.api.history.eventCountMismatch': {
    description:
      'Refusal of a change-history rewrite with a change set whose events do not pair one-to-one with its change lines. A "legacy set" is one written before events were recorded.',
  },
  'admin.api.history.trailingInvalid': {
    description:
      'Refusal of a change-history rewrite with a change set whose trailing field (hand-written text kept after its change lines) is not a list of text.',
  },
  'admin.api.history.trailingMultiline': {
    description:
      'Refusal of a change-history rewrite whose hand-written trailing text holds an entry spanning several lines.',
  },
  'admin.api.history.trailingLooksLikeChange': {
    description:
      'Refusal of a change-history rewrite whose hand-written trailing text holds a line that would read back as a change line or a heading. "## " is literal markdown.',
  },
  'admin.api.history.trailingOpenFence': {
    description:
      'Refusal of a change-history rewrite whose hand-written trailing text opens a ``` code block and never closes it.',
  },

  // ── Site build ────────────────────────────────────────────────────────
  'admin.api.buildSite.busy': {
    description:
      'Error body (HTTP 503) when a site build is requested while one is already running.',
  },
  'admin.api.buildSite.stepStarting': {
    description:
      'Progress note an agent (MCP client) sees as a site build starts. The trailing ellipsis means "in progress".',
  },
  'admin.api.buildSite.stepBuilding': {
    description:
      'Progress note while the site build runs. The trailing ellipsis means "in progress".',
  },
  'admin.api.buildSite.stepPublishing': {
    description:
      'Progress note while the built site is moved into place. dist/ is a folder name and stays verbatim.',
  },
  'admin.api.buildSite.failed': {
    description:
      'Error body (HTTP 500) when the site build process failed and printed nothing. {code} is its numeric exit code.',
  },
  'admin.api.buildSite.failedWithOutput': {
    description:
      'admin.api.buildSite.failed followed by the end of what the build printed. {output} is untranslated program output.',
  },

  // ── Deck import ───────────────────────────────────────────────────────
  'admin.api.importDeck.modeRequired': {
    description:
      'Refusal of a deck import whose mode is neither "url" nor "text". mode, url, text and content are request vocabulary and stay verbatim.',
  },
  'admin.api.importDeck.urlRequiredForMode': {
    description: 'Refusal of a deck import in "url" mode without a url field.',
  },
  'admin.api.importDeck.syncPrintingsRequired': {
    description:
      'Refusal of a URL deck import that does not say whether to keep the source’s printings. syncPrintings, true and false stay verbatim.',
  },
  'admin.api.importDeck.contentRequiredForMode': {
    description: 'Refusal of a deck import in "text" mode without a content field.',
  },
  'admin.api.importDeck.syncPrintingsUrlOnly': {
    description:
      'Refusal of a pasted-text deck import that sent syncPrintings, which only URL imports take.',
  },
  'admin.api.importDeck.urlRequired': {
    description: 'Refusal of a URL deck import whose url is blank.',
  },
  'admin.api.importDeck.contentRequired': {
    description: 'Refusal of a pasted-text deck import whose text is blank.',
  },
  'admin.api.importDeck.defaultName': {
    description:
      'Name given to a deck imported from pasted text when the request names none. It becomes the deck’s name and file name, so keep it short.',
  },
  'admin.api.importDeck.noCardLines': {
    description: 'Refusal of a pasted-text deck import in which no line reads as a card.',
  },
  'admin.api.importDeck.cancelled': {
    description: 'Refusal when a deck import was cancelled before anything was written.',
  },
  'admin.api.importDeck.imported': {
    description:
      'Success body of a deck import. {name} is the deck’s name. {notes} is zero or more of the admin.api.importDeck.*Note messages, each opening with its own " — " separator — keep no space before {notes}.',
  },
  'admin.api.importDeck.skippedNote': {
    description:
      'Note appended to admin.api.importDeck.imported: pasted lines that could not be read and were left out. **Keep the leading " — "** — it separates this note from the text before it.',
  },
  'admin.api.importDeck.labelsDroppedNote': {
    description:
      'Note appended to admin.api.importDeck.imported: card lines imported without the labels (e.g. proxy, trade) they carried. **Keep the leading " — "**.',
  },
  'admin.api.importDeck.categoryNotesNote': {
    description:
      'Note appended to admin.api.importDeck.imported for a URL import: notices about the source deck’s card categories (names that were refused, or a categories file that could not be written). **Keep the leading " — "**.',
  },
  'admin.api.importDeck.misreadNote': {
    description:
      'Note appended to admin.api.importDeck.imported for a pasted-text import: lines that were imported but probably misread (e.g. a printing left in the card name). **Keep the leading " — "**.',
  },

  // ── CSV import ────────────────────────────────────────────────────────
  'admin.api.importCsv.invalidRequest': {
    description:
      'Refusal of a CSV import missing a required field. {types} is the comma-separated list of list types and {modes} the |-separated list of import modes; every field name (listType, name, content, columns, mode, format, hasHeader) stays verbatim.',
  },
  'admin.api.importCsv.nameRequired': {
    description: 'Refusal of a CSV import without a list name. "name" is the request field.',
  },
  'admin.api.importCsv.formatRequired': {
    description:
      'Refusal of a CSV import that creates or replaces a deck without saying its format (e.g. commander). "format" is the request field.',
  },
  'admin.api.importCsv.parseFailed': {
    description:
      'Refusal of a CSV import whose text cannot be read as CSV. {reason} is untranslated parser prose.',
  },
  'admin.api.importCsv.headerSkipped': {
    description:
      'Warning on a CSV import: the first row was treated as the column headings and not imported. {row} is that row’s raw text.',
  },
  'admin.api.importCsv.headerSuspicious': {
    description:
      'Warning on a CSV import: the first row was skipped as a heading row but looks like a card. {row} is its raw text; hasHeader and false are request vocabulary and stay verbatim.',
  },
  'admin.api.importCsv.noDataRows': {
    description: 'Refusal of a CSV import with no rows besides the heading row.',
  },
  'admin.api.importCsv.imported': {
    description:
      'Success body of a CSV import that created or replaced a list. {cards} is a card count with its noun (domain.count.cards, e.g. "3 cards"); {name} is the list’s name. One branch per list type.',
  },
  'admin.api.importCsv.appended': {
    description:
      'Success body of a CSV import that added to an existing list. {cards} is a card count with its noun (e.g. "3 cards"); {name} is the list’s name. One branch per list type.',
  },
  'admin.api.importCsv.partial': {
    description:
      'A CSV import result when some rows were refused: {result} is admin.api.importCsv.imported or .appended, {failed} is admin.api.importCsv.rowsFailed. Two independent clauses.',
  },
  'admin.api.importCsv.rowsFailed': {
    description:
      'Clause of admin.api.importCsv.partial: CSV rows that failed validation and were not imported.',
  },

  // ── Change-bundle import ──────────────────────────────────────────────
  'admin.api.importChanges.applied': {
    description:
      'Success body of a change-bundle import. {changes} is a count of changes with its noun (e.g. "3 changes") and {lists} a count of lists with its noun (e.g. "2 lists").',
  },
  'admin.api.importChanges.appliedWithFailures': {
    description:
      'Success body of a change-bundle import in which some lists failed. {changes} is a count of changes with its noun (e.g. "3 changes"); {count} is how many lists failed.',
  },
  'admin.api.importChanges.requestFailed': {
    description:
      'Why one list of a change-bundle import failed, when the internal load or save gave no reason. {status} is the numeric HTTP status.',
  },
  'admin.api.importChanges.unhandledKind': {
    description:
      'Internal error that only a programming mistake can produce: a change-bundle list of an unknown kind reached the importer.',
  },
  'admin.api.importChanges.targetOmitted': {
    description:
      'Internal error that only a programming mistake can produce: the import plan lost track of a list. {kind} is the untranslated list type (deck, collection, wanted); {name} the list’s name.',
  },

  // ── Sync requests (decks and collection) ──────────────────────────────
  'admin.api.sync.progressItem': {
    description:
      'Progress note an agent (MCP client) sees as a sync reaches one deck or collection list. {item} is its name; the position (e.g. "(2/5)") is appended after it.',
  },
  'admin.api.sync.invalidBody': {
    description: 'Refusal of a sync request whose body is not a JSON object.',
  },
  'admin.api.sync.directionRequired': {
    description:
      'Refusal of a sync request without a direction. {first} and {second} are the two accepted values (push, pull), which stay verbatim.',
  },
  'admin.api.sync.queryFlagInvalid': {
    description:
      "Refusal of a streamed sync whose {field} query parameter (untranslated, e.g. dryRun) is neither 'true' nor 'false', which stay verbatim.",
  },
  'admin.api.sync.namesNotArray': {
    description:
      'Refusal of a sync request whose {field} (an untranslated request field) is not a list of names. {names} selects what the names are: decks, or collection lists.',
  },
  'admin.api.sync.namesAllBlank': {
    description:
      'Refusal of a sync request whose {field} list of names (untranslated request field) holds only blank entries.',
  },
  'admin.api.sync.namesBlank': {
    description:
      'Refusal of a sync request whose {field} list of names (untranslated request field) holds a blank entry where order matters.',
  },
  'admin.api.collectionSync.listNameInvalid': {
    description:
      'Refusal of a collection sync request whose {field} (an untranslated request field path, e.g. into) is not a collection list name.',
  },
  'admin.api.collectionSync.choiceNotObject': {
    description:
      'Refusal of a collection sync request with a malformed removal choice. {field} is its untranslated JSON path, e.g. removalAssignments[0].choices[1]; "list" and "copies" are the fields it needs.',
  },
  'admin.api.collectionSync.copiesInvalid': {
    description:
      'Refusal of a collection sync request with a removal choice whose copy count is not a whole number of one or more. {field} is its untranslated JSON path.',
  },
  'admin.api.collectionSync.assignmentsNotArray': {
    description:
      'Refusal of a collection sync request whose removalAssignments is not a list. {shape} is the untranslated JSON shape of an entry, "{ key, choices }".',
  },
  'admin.api.collectionSync.assignmentsNotJson': {
    description:
      'Refusal of a streamed collection sync whose removalAssignments query parameter is not JSON. {shape} is the untranslated JSON shape of an entry.',
  },
  'admin.api.collectionSync.assignmentNotObject': {
    description:
      'Refusal of a collection sync request with a malformed removal assignment. {field} is its untranslated JSON path; "key" and "choices" are the fields it needs.',
  },
  'admin.api.collectionSync.assignmentKeyInvalid': {
    description:
      'Refusal of a collection sync request with a removal assignment whose key does not name an ambiguous removal (a removal that matched copies in more than one list). {field} is its untranslated JSON path.',
  },
  'admin.api.collectionSync.choicesInvalid': {
    description:
      'Refusal of a collection sync request with a removal assignment that lists no choices. {field} is its untranslated JSON path; {shape} the JSON shape of a choice, "{ list, copies }".',
  },
  'admin.api.collectionSync.strategyConflict': {
    description:
      'Refusal of a collection sync request that sends both ways of settling ambiguous removals (removalPriority and removalAssignments, which stay verbatim).',
  },
  'admin.api.collectionSync.csvFileUnsupported': {
    description:
      'Refusal of a collection sync request that asks for a CSV file to be written, which only the command line can do. csvFile, --csv-file and csv: true are request and command vocabulary and stay verbatim.',
  },
} as const satisfies MetaFor<typeof adminApiMessages>
