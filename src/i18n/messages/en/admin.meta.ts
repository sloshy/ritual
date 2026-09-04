/** Translator metadata for the `admin.*` namespace. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { adminMessages } from './admin'

export const adminMeta = {
  'admin.list.createTitle': {
    description:
      'Title of the dialog that creates a new list, one branch per list type. Translate each branch as a whole sentence — do not assemble it from a verb plus a noun.',
  },
  'admin.move.unsavedWarning': {
    description:
      'Shown when leaving the Move Cards page with moves queued but not committed. A "move" is one card sent from one list to another.',
  },
  'admin.api.move.moved': {
    description:
      'Result of committing queued moves. {count} counts copies. Further clauses (how many were skipped, which notes were dropped) are appended after it.',
  },
  'admin.move.matches': {
    description:
      'How many cards the Move Cards search turned up. A "match" is one card name found in the enabled source lists.',
  },
  'admin.sync.previewDecks': {
    description:
      'Label of the Sync Decks run button for a dry run over a chosen subset. {count} is how many decks are ticked.',
  },
  'admin.sync.pullDecks': {
    description:
      'Label of the Sync Decks run button for a run that applies Archidekt’s changes to the chosen decks.',
  },
  'admin.sync.pushDecks': {
    description:
      'Label of the Sync Decks run button for a run that sends the chosen decks’ local changes to Archidekt.',
  },
  'admin.sync.allDecksAction': {
    description:
      'Label of the Sync Decks run button when every deck is ticked, so there is no count to name. {action} is preview (dry run), pull (Archidekt → local) or push (local → Archidekt).',
  },
  'admin.sync.previewLists': {
    description:
      'Label of the Sync Collection run button for a dry run over the chosen collection lists. {count} is how many are ticked.',
  },
  'admin.sync.pullLists': {
    description:
      'Label of the Sync Collection run button for a run that applies Archidekt’s changes to the chosen lists.',
  },
  'admin.sync.pushLists': {
    description:
      'Label of the Sync Collection run button for a run that sends the chosen lists to Archidekt.',
  },
  'admin.sync.wholeCollectionAction': {
    description:
      'Label of the Sync Collection run button when the scope is every collection list. See admin.sync.allDecksAction for {action}.',
  },
  'admin.sync.lastSyncedLabel': {
    description: 'Label before the time of the most recent sync run. Ends with a colon.',
  },
  'admin.sync.lastSyncedAgo': {
    description:
      'How long ago a sync ran. {duration} is an already-rendered span such as "2 hours" or "3 days".',
  },
  'admin.sync.neverSynced': {
    description: 'Shown in place of a time for a deck or list that has never been synced.',
  },
  'admin.sync.progress': {
    description: 'Heading above the live log of a sync run.',
  },
  'admin.sync.syncing': {
    description: 'Label of the run button while a sync is in flight.',
  },
  'admin.sync.connectionDropped': {
    description:
      'Error shown when the progress stream died mid-run. The run itself is still going on the server, which is why it says to reload rather than to retry.',
  },
  'admin.sync.complete': {
    description: 'Fallback summary for a finished sync run whose own summary could not be read.',
  },
  'admin.sync.directionHeading': {
    description: 'Heading of the pull/push control on both sync pages.',
  },
  'admin.sync.directionLabel': {
    description: 'Accessible name of the pull/push control on both sync pages.',
  },
  'admin.sync.pull': {
    description: 'The direction that applies Archidekt’s state to your local files.',
  },
  'admin.sync.push': {
    description: 'The direction that sends your local state to Archidekt.',
  },
  'admin.sync.filterHeading': {
    description: 'Heading of the control choosing which kinds of change a sync run applies.',
  },
  'admin.sync.filterLabel': {
    description: 'Accessible name of the change-filter control.',
  },
  'admin.sync.filterAll': {
    description: 'Change-filter option: apply additions, removals and quantity changes alike.',
  },
  'admin.sync.filterAllDesc': {
    description: 'Explanation shown under the "All changes" filter option.',
  },
  'admin.sync.filterAdditions': {
    description: 'Change-filter option: apply only things that add cards.',
  },
  'admin.sync.filterAdditionsDesc': {
    description:
      'Explanation shown under the "Additions only" filter option. "The destination" is deliberately relative: it is your files on a pull and Archidekt on a push.',
  },
  'admin.sync.filterRemovals': {
    description: 'Change-filter option: apply only things that take cards away.',
  },
  'admin.sync.filterRemovalsDesc': {
    description: 'Explanation shown under the "Removals only" filter option.',
  },
  'admin.sync.unreadableDecks': {
    description:
      'Lead of the panel asking permission to sync decks whose files contain lines the parser could not read. Syncing anyway loses those lines.',
  },
  'admin.sync.unreadableLists': {
    description:
      'Lead of the panel asking permission to sync collection lists whose files contain lines the parser could not read. Syncing anyway loses those lines.',
  },
  'admin.sync.ambiguousLead': {
    description:
      'Explains why a sync run wrote nothing: a removal matched copies in more than one list, so it could not be applied anywhere. {emphasis} is rendered in bold — place it where the emphasis belongs in your language.',
  },
  'admin.sync.nothingWritten': {
    description:
      'The bolded {emphasis} fragment of admin.sync.ambiguousLead: the run made no change to any file.',
  },
  'admin.syncCsv.uploaded': {
    description:
      'What the CSV path did: cards were uploaded to Archidekt in one or more HTTP requests. {size} is an already-rendered phrase like "12 cards (14 rows)"; {count} is the number of requests.',
  },
  'admin.syncCsv.uncachedPlanned': {
    description:
      'Preview wording: these additions have no printing in the local Scryfall cache, so no CSV row could be keyed for them and they would be added individually instead.',
  },
  'admin.syncCsv.uncachedApplied': {
    description:
      'Same as admin.syncCsv.uncachedPlanned, but for a run that already happened — the cards were added individually.',
  },

  // ── App shell and layout ──────────────────────────────────────────────
  'admin.app.loading': {
    description: 'Placeholder while the admin app checks whether it is set up and signed in.',
  },
  'admin.app.requestFailed': {
    description:
      'Last-resort error when a request failed and neither the caller nor the server supplied a reason.',
  },
  'admin.layout.title': {
    description:
      'Product name in the admin header and mobile menu. A brand name — leave untranslated unless the product is renamed in your language.',
  },
  'admin.layout.logout': { description: 'Button that ends the admin session.' },
  'admin.layout.toggleMenu': {
    description: 'Accessible name of the hamburger button that opens the navigation on a phone.',
  },
  'admin.layout.allSelected': {
    description:
      'Button opening the cross-list selection menu in the header. Names the cards ticked across every list.',
  },
  'admin.layout.clearSelections': {
    description: 'Menu item that unticks every selected card across all lists.',
  },
  'admin.layout.removeSelectedTitle': {
    description:
      'Title of the confirmation asking whether to delete every selected card from its list file.',
  },
  'admin.layout.removeSelectedConfirm': {
    description: 'Confirm button of the remove-selected confirmation. A destructive action.',
  },
  'admin.layout.actionFailedTitle': {
    description:
      'Title of the notice shown when a cross-list remove or move was refused; the server’s own message is the body.',
  },
  'admin.layout.notesDroppedTitle': {
    description: 'Title of the notice listing per-card notes lost during a move.',
  },
  'admin.layout.notesDropped': {
    description:
      'Body of the dropped-notes notice. A card moved onto a line that already existed keeps that line’s note, so its own is lost; {count} is how many.',
  },
  'admin.layout.droppedNote': {
    description:
      'One row of the dropped-notes notice: the card name and the note text that was lost.',
  },
  'admin.layout.categoriesPrunedTitle': {
    description:
      'Title of the notice shown when a navbar move or remove took a list’s last line of a card, so that card’s categories were dropped from the list.',
  },

  // ── Shared controls ───────────────────────────────────────────────────
  'admin.select.chooseList': {
    description:
      'Empty option of a list dropdown, framed by em dashes. Means "nothing chosen yet".',
  },
  'admin.import.upload': { description: 'Tab choosing to supply data by uploading a file.' },
  'admin.import.pasteText': {
    description: 'Tab choosing to supply data by pasting it into a text box.',
  },
  'admin.import.chooseFile': {
    description: 'Button that opens the operating system’s file picker.',
  },
  'admin.import.noFile': {
    description: 'Shown beside the file picker while no file has been chosen.',
  },
  'admin.import.importing': {
    description: 'Label of an import button while the request is in flight.',
  },

  // ── Dashboard tiles ───────────────────────────────────────────────────
  'admin.dashboard.listEditor': {
    description: 'Dashboard tile description for the page that edits list contents.',
  },
  'admin.dashboard.moveCards': {
    description: 'Dashboard tile description for the page that moves cards between lists.',
  },
  'admin.dashboard.listManager': {
    description: 'Dashboard tile description for the page that creates, renames and deletes lists.',
  },
  'admin.dashboard.history': {
    description: 'Dashboard tile description for the page that edits a list’s change log.',
  },
  'admin.dashboard.importDeck': {
    description: 'Dashboard tile description for the deck import page.',
  },
  'admin.dashboard.buildSite': {
    description: 'Dashboard tile description for the page that builds the public static site.',
  },
  'admin.dashboard.cacheRefresh': {
    description: 'Dashboard tile description for the page that redownloads Scryfall card data.',
  },
  'admin.dashboard.deckSync': { description: 'Dashboard tile description for the deck sync page.' },
  'admin.dashboard.collectionSync': {
    description: 'Dashboard tile description for the collection sync page.',
  },
  'admin.dashboard.archidektLogin': {
    description: 'Dashboard tile description for the Archidekt sign-in page.',
  },
  'admin.dashboard.auditLog': {
    description: 'Dashboard tile description for the login/activity history page.',
  },
  'admin.dashboard.settings': { description: 'Dashboard tile description for the settings page.' },

  // ── Sign-in / first-run setup ─────────────────────────────────────────
  'admin.auth.signInSubtitle': { description: 'Subtitle under the logo on the sign-in screen.' },
  'admin.auth.createSubtitle': {
    description: 'Subtitle under the logo on the first-run screen that creates the admin account.',
  },
  'admin.auth.username': { description: 'Field label for the admin account name.' },
  'admin.auth.password': { description: 'Field label for the admin account password.' },
  'admin.auth.totpCode': {
    description: 'Field label for the six-digit code from an authenticator app.',
  },
  'admin.auth.passwordHint': {
    description:
      'Hint under the password field on the first-run screen. {count} is the minimum length.',
  },
  'admin.auth.credentialsRequired': {
    description: 'Validation error when the sign-in form is submitted with an empty field.',
  },
  'admin.auth.passwordTooShort': {
    description:
      'Validation error when a new password is below the minimum length. {count} is that minimum.',
  },
  'admin.auth.totpRequired': {
    description: 'Error telling the user the account has two-factor auth on and a code is needed.',
  },
  'admin.auth.totpInvalid': {
    description: 'Error when the supplied authenticator code was rejected.',
  },
  'admin.auth.invalidCredentials': {
    description:
      'Error for a rejected sign-in. Deliberately does not say which of the two was wrong.',
  },
  'admin.auth.rateLimited': {
    description:
      'Error after too many failed sign-ins, naming the wait. {count} is a whole number of minutes.',
  },
  'admin.auth.rateLimitedLater': {
    description: 'admin.auth.rateLimited when the server did not say how long the wait is.',
  },
  'admin.auth.setupLoginFailed': {
    description:
      'Error when the account was created but the automatic sign-in that follows failed.',
  },
  'admin.auth.connectionFailed': {
    description: 'Error when the sign-in request never reached the server.',
  },
  'admin.auth.pleaseWait': {
    description: 'Label of the sign-in button while the request is in flight.',
  },
  'admin.auth.signIn': { description: 'Submit button of the sign-in form.' },
  'admin.auth.createAccount': { description: 'Submit button of the first-run account form.' },

  // ── TOTP enrollment ───────────────────────────────────────────────────
  'admin.totp.setupFailed': {
    description: 'Error when the server refused to begin two-factor enrollment.',
  },
  'admin.totp.startFailed': {
    description: 'Error when the request to begin two-factor enrollment never completed.',
  },
  'admin.totp.enabled': { description: 'Success message after two-factor auth is switched on.' },
  'admin.totp.verifyFailed': {
    description: 'Error when the enrollment code could not be checked.',
  },
  'admin.totp.disabled': { description: 'Success message after two-factor auth is switched off.' },
  'admin.totp.disableFailed': {
    description: 'Error when two-factor auth could not be switched off.',
  },
  'admin.totp.statusEnabled': {
    description: 'Status line stating that two-factor auth is currently on.',
  },
  'admin.totp.disabling': {
    description: 'Button label while two-factor auth is being switched off.',
  },
  'admin.totp.disable': { description: 'Button that switches two-factor auth off.' },
  'admin.totp.addAccount': {
    description: 'Instruction above the enrollment secret. Ends with a colon.',
  },
  'admin.totp.secretLabel': {
    description:
      'Label for the shared secret, for typing into an authenticator by hand. Ends with a colon.',
  },
  'admin.totp.uriLabel': {
    description: 'Label for the otpauth:// URI a QR-code generator can encode. Ends with a colon.',
  },
  'admin.totp.enterCode': {
    description:
      'Label of the field confirming enrollment with a generated code. Ends with a colon.',
  },
  'admin.totp.verifying': {
    description: 'Button label while the enrollment code is being checked.',
  },
  'admin.totp.verify': { description: 'Button that checks the code and completes enrollment.' },
  'admin.totp.settingUp': { description: 'Button label while enrollment is starting.' },
  'admin.totp.setUp': { description: 'Button that begins two-factor enrollment.' },

  // ── Archidekt session ─────────────────────────────────────────────────
  'admin.archidekt.signedIn': {
    description: 'Alert confirming a stored Archidekt session. {username} is the account name.',
  },
  'admin.archidekt.yourAccount': {
    description:
      'Stands in for {username} in admin.archidekt.signedIn when the account name is unknown.',
  },
  'admin.archidekt.notSignedIn': {
    description: 'Shown when no Archidekt session is stored at all.',
  },
  'admin.archidekt.expired': {
    description: 'Shown when a stored Archidekt session exists but is no longer usable.',
  },
  'admin.archidekt.usernameLabel': {
    description: 'Field label of the Archidekt sign-in form; either identifier is accepted.',
  },
  'admin.archidekt.passwordLabel': {
    description: 'Password field label of the Archidekt sign-in form.',
  },
  'admin.archidekt.loggingIn': {
    description: 'Label of the Archidekt sign-in button while the request is in flight.',
  },
  'admin.archidekt.login': { description: 'Submit button of the Archidekt sign-in form.' },
  'admin.archidekt.loginFailed': {
    description: 'Fallback error when the Archidekt sign-in request failed without a message.',
  },
  'admin.archidektPage.desc': { description: 'Lead paragraph of the Archidekt Login page.' },
  'admin.archidektPage.checking': {
    description: 'Placeholder while the stored Archidekt session is being inspected.',
  },
  'admin.archidektPage.statusUnavailable': {
    description: 'Shown when the stored Archidekt session could not be inspected.',
  },
  'admin.archidektPage.accessToken': {
    description: 'Row label for the short-lived token the current Archidekt session uses.',
  },
  'admin.archidektPage.refreshToken': {
    description: 'Row label for the long-lived token that renews the access token.',
  },
  'admin.archidektPage.willRefresh': {
    description:
      'Reassurance that an expired access token is not a problem while the refresh token lives.',
  },
  'admin.archidektPage.expiryValid': {
    description:
      'Token state when it works but carries no expiry time. A sentence fragment filling a table cell.',
  },
  'admin.archidektPage.expiryUnknown': {
    description: 'Token state when neither its validity nor its expiry could be determined.',
  },
  'admin.archidektPage.expiresIn': {
    description:
      'Token state: still good. {duration} is a rendered span, {when} an absolute date and time.',
  },
  'admin.archidektPage.expiredAgo': {
    description:
      'Token state: no longer good. {duration} is how long ago, {when} the absolute moment.',
  },

  // ── Audit Log ─────────────────────────────────────────────────────────
  'admin.auditLog.loading': { description: 'Placeholder while the login history loads.' },
  'admin.auditLog.loadFailed': { description: 'Error when the login history could not be loaded.' },
  'admin.auditLog.refresh': { description: 'Button that reloads the login history.' },
  'admin.auditLog.empty': { description: 'Shown when no sign-in has ever been recorded.' },
  'admin.auditLog.colTime': { description: 'Table column: when the attempt happened.' },
  'admin.auditLog.colStatus': { description: 'Table column: whether the attempt succeeded.' },
  'admin.auditLog.colUsername': { description: 'Table column: the account name that was tried.' },
  'admin.auditLog.colIp': {
    description:
      'Table column: the network address the attempt came from. Keep short — the column is narrow.',
    maxLen: 12,
  },
  'admin.auditLog.colReason': { description: 'Table column: why the attempt was refused.' },
  'admin.auditLog.colUserAgent': {
    description: 'Table column: the browser or tool that made the attempt.',
  },
  'admin.auditLog.success': { description: 'Badge on a sign-in that worked.' },
  'admin.auditLog.failed': { description: 'Badge on a sign-in that was refused.' },

  // ── Build Site ────────────────────────────────────────────────────────
  'admin.buildSite.desc': { description: 'Lead paragraph of the Build Site page.' },
  'admin.buildSite.building': { description: 'Button label while the site build is running.' },
  'admin.buildSite.build': { description: 'Button that starts a site build.' },
  'admin.buildSite.failed': {
    description: 'Error when the build request failed without a message of its own.',
  },
  'admin.buildSite.step': {
    description:
      'Label above the Build Site progress bar naming the current structural step; `step` is one of starting, building, publishing, done.',
  },
  'admin.buildSite.output': {
    description:
      'Heading of the live log box on the Build Site page showing the build’s own output lines.',
  },
  'admin.buildSite.connectionDropped': {
    description:
      'Error on the Build Site page when the event stream dropped mid-build. The build keeps running server-side, so the user is told to check back rather than to retry.',
  },

  // ── Refresh Cache ─────────────────────────────────────────────────────
  'admin.cache.desc': { description: 'Lead paragraph of the Refresh Cache page.' },
  'admin.cache.stageDownload': {
    description: 'Progress step: the bulk file is streaming in and being parsed as it arrives.',
  },
  'admin.cache.stageSave': {
    description: 'Progress step: the parsed cards are being written to the local cache.',
  },
  'admin.cache.fallbackProgress': {
    description: 'Shown when the refresh is running but its progress stream is unavailable.',
  },
  'admin.cache.refreshFailed': { description: 'Error when the refresh request failed outright.' },
  'admin.cache.streamFailed': {
    description:
      'Error when the refresh reported a failure over its progress stream without a message.',
  },
  'admin.cache.refreshed': {
    description:
      'Fallback success message when the refresh finished but its own message could not be read.',
  },
  'admin.cache.downloading': { description: 'Label beside the download progress bar.' },
  'admin.cache.refreshing': { description: 'Button label while a refresh is running.' },
  'admin.cache.refresh': { description: 'Button that starts a cache refresh.' },

  // ── Card Kingdom buylist ──────────────────────────────────────────────
  'admin.buylist.title': {
    description:
      'Heading of the card describing the Card Kingdom buylist feed. Card Kingdom is a company name.',
  },
  'admin.buylist.desc': {
    description:
      'What the buylist feed is and when it downloads. {command} is a CLI command rendered as code — do not translate it.',
  },
  'admin.buylist.command': {
    description:
      'The CLI command named by admin.buylist.desc. A literal command — never translate.',
  },
  'admin.buylist.empty': { description: 'Shown when no buylist has ever been downloaded.' },
  'admin.buylist.statusFailed': {
    description: 'Error when the cached buylist’s state could not be read.',
  },
  'admin.buylist.refreshFailed': { description: 'Error when the buylist download failed.' },
  'admin.buylist.notUpdated': {
    description:
      'Shown when a refresh finished but left the previous copy in place; warnings below say why.',
  },
  'admin.buylist.updated': {
    description:
      'Success message after a buylist download. {count} is how many products the feed carried.',
  },
  'admin.buylist.downloadedLabel': { description: 'Row label: when the local copy was fetched.' },
  'admin.buylist.stampLabel': {
    description: 'Row label: the date Card Kingdom itself put on the feed.',
  },
  'admin.buylist.stale': {
    description: 'Suffix marking a local copy older than a day. Includes its own parentheses.',
  },
  'admin.buylist.productsLabel': { description: 'Row label: how many products the feed lists.' },
  'admin.buylist.downloading': { description: 'Button label while the buylist is downloading.' },
  'admin.buylist.refresh': { description: 'Button that forces a buylist download now.' },

  // ── Collection default-labels modal ───────────────────────────────────
  'admin.labels.title': {
    description: 'Title of the dialog setting a list’s default card labels.',
  },
  'admin.labels.desc': {
    description: 'Explains that the chosen labels apply to every card that does not set its own.',
  },
  'admin.labels.groupLabel': {
    description: 'Accessible name of the radio group of label choices.',
  },
  'admin.labels.saving': { description: 'Button label while the labels are being saved.' },
  'admin.labels.save': { description: 'Button that saves the chosen default labels.' },

  // ── Front-matter writes (shared by every metadata dialog) ─────────────
  'admin.metadata.saveFailed': {
    description:
      'Error shown by any dialog that writes a list’s front matter (default labels, cover image) when the write failed. {status} is an HTTP status code.',
  },

  // ── List cover-image dialog ───────────────────────────────────────────
  'admin.listImage.title': {
    description:
      'Title of the dialog choosing the image a deck, collection or wanted list shows as its cover on the site.',
  },
  'admin.listImage.desc': {
    description:
      'Explains the four choices the dialog offers. The "art directory" is the configurable folder (artDir) the user keeps local images in.',
  },
  'admin.listImage.modeLabel': {
    description: 'Accessible name of the radio group choosing where the cover image comes from.',
  },
  'admin.listImage.modeDefault': {
    description:
      'Radio choice: no override — the cover is picked by the built-in rule, described by admin.listImage.modeDefaultNote.',
  },
  'admin.listImage.modeDefaultNote': {
    description: 'The built-in rule, shown under the "Automatic" choice.',
  },
  'admin.listImage.modeCard': {
    description: 'Radio choice: the cover is one of the cards the list itself holds.',
  },
  'admin.listImage.cardLabel': {
    description: 'Label of the dropdown choosing which of the list’s cards is the cover.',
  },
  'admin.listImage.noCards': {
    description:
      'Shown in place of the card dropdown when the list, as last saved, holds no cards to choose from. Cards added in the current editing session are deliberately not offered — they have no saved line yet.',
  },
  'admin.listImage.previewAlt': {
    description: 'Alt text of the preview image in the dialog.',
  },
  'admin.listImage.invalid': {
    description:
      'Shown under the field when what was typed is not a usable image reference, so Save stays disabled. {reason} is untranslated engine prose from the image parser (e.g. \'"../x.png" escapes the art directory\').',
  },
  'admin.listImage.saving': { description: 'Button label while the cover image is being saved.' },
  'admin.listImage.save': { description: 'Button that saves the chosen cover image.' },

  // ── Custom art dialog ─────────────────────────────────────────────────
  'admin.art.title': {
    description:
      'Title of the dialog that replaces a card’s printing image with an image of the user’s own.',
  },
  'admin.art.desc': {
    description:
      'Explains what the dialog does. {name} is the card’s name. The "art directory" is the configurable folder (artDir) the user keeps local images in.',
  },
  'admin.art.modeLabel': {
    description:
      'Accessible name of the radio group choosing between a local file and a web address.',
  },
  'admin.art.modeFile': {
    description: 'Radio choice: the image is a file inside the configured art directory.',
  },
  'admin.art.modeUrl': { description: 'Radio choice: the image is linked from the web.' },
  'admin.art.fileLabel': {
    description:
      'Label of the text field holding the image’s path relative to the art directory (e.g. proxies/sol-ring.jpg).',
  },
  'admin.art.urlLabel': { description: 'Label of the text field holding the image’s web address.' },
  'admin.art.filePlaceholder': {
    description:
      'Example file path shown in the empty field. A path, not prose — translate only if the example would be clearer localized.',
  },
  'admin.art.urlPlaceholder': {
    description: 'Example image URL shown in the empty field. A URL, not prose.',
  },
  'admin.art.previewAlt': {
    description: 'Alt text of the preview image in the dialog. {name} is the card’s name.',
  },
  'admin.art.previewFailed': {
    description:
      'Shown under the preview when the browser could not load the image at the entered path or URL.',
  },
  'admin.art.invalid': {
    description:
      'Shown under the field when what was typed is not a usable image reference, so Save stays disabled. {reason} is untranslated engine prose from the art parser (e.g. \'"../x.png" escapes the art directory\').',
  },
  'admin.art.saveFailed': {
    description: 'Error when the art could not be saved. {status} is an HTTP status code.',
  },
  'admin.art.saving': { description: 'Button label while the art is being saved.' },
  'admin.art.save': { description: 'Button that saves the entered image as the card’s art.' },
  'admin.art.clear': {
    description:
      'Button that removes the card’s custom art, so it shows its real printing again. Only shown when the card has custom art.',
  },
  'admin.art.pendingNote': {
    description:
      'Note in the custom-art dialog when the card was added during this editing session: the art is held with the pending changes and written by the next save, rather than immediately like it is for a card already in the list.',
  },
  'admin.art.pendingFailed': {
    description:
      'Error banner shown when the list saved but writing back the custom art it had been holding failed afterwards. {count} is how many cards failed; {cardId} is the first failing card line’s internal &N number, and {reason} is the server’s own sentence about that one.',
  },

  // ── Change History ────────────────────────────────────────────────────
  'admin.combine.title': {
    description: 'Title of the dialog merging one change set into another.',
  },
  'admin.combine.message': {
    description:
      'Explains the merge: the chosen set’s lines move into {timestamp} and the chosen set is deleted. {timestamp} appears twice.',
  },
  'admin.combine.noCandidates': {
    description:
      'Empty state of the Combine dialog when no other change set can merge with the chosen one. "ritual-changes" is the literal name of the fenced block in .changes.md files and must not be translated.',
  },
  'admin.history.discardTitle': {
    description:
      'Title of the confirmation shown when leaving the Change History page with unsaved edits.',
  },
  'admin.history.discardMessage': {
    description: 'Body of the leave-with-unsaved-edits confirmation.',
  },
  'admin.history.discardConfirm': {
    description: 'Confirm button that abandons unsaved change-history edits.',
  },
  'admin.history.rewriteTitle': {
    description: 'Title of the confirmation before replacing a whole change log.',
  },
  'admin.history.rewriteMessage': {
    description:
      'Body of the rewrite confirmation: every existing set is replaced by one describing the list as it is now.',
  },
  'admin.history.rewriteConfirm': { description: 'Confirm button of the rewrite confirmation.' },
  'admin.history.discardAllTitle': {
    description: 'Title of the confirmation that reverts every edit made on the page.',
  },
  'admin.history.discardAllMessage': { description: 'Body of the revert-everything confirmation.' },
  'admin.history.selectorLabel': {
    description: 'Label of the dropdown choosing whose change history to edit.',
  },
  'admin.history.rewriteButton': {
    description:
      'Button that replaces the change log with one generated from the list’s current contents.',
  },
  'admin.history.rewriteDisabled': {
    description:
      'Tooltip explaining why the rewrite button is unavailable: the list holds no cards.',
  },
  'admin.history.undo': { description: 'Button that reverses the last change-history edit.' },
  'admin.history.saving': {
    description: 'Button label while the change history is being written.',
  },
  'admin.history.save': { description: 'Button that writes the edited change history to disk.' },
  'admin.history.discard': { description: 'Button that reverts every edit made on the page.' },
  'admin.history.loadingLists': { description: 'Placeholder while the list of lists loads.' },
  'admin.history.chooseList': { description: 'Empty state before a list has been chosen.' },
  'admin.history.loading': { description: 'Placeholder while one list’s change history loads.' },
  'admin.history.summary': {
    description:
      'Before → after tallies of an edited change history. A "change set" is one timestamped group; a "change line" is one entry inside it.',
  },
  'admin.history.noHistory': {
    description: 'Shown when the chosen list has no change log at all.',
  },
  'admin.history.noHistoryHint': {
    description:
      'Follows admin.history.noHistory. {action} is the bolded name of the rewrite button.',
  },
  'admin.history.combine': {
    description: 'Row action that merges another change set into this one.',
  },
  'admin.history.editTime': { description: 'Row action that changes a change set’s timestamp.' },
  'admin.history.delete': { description: 'Row action that removes a change set.' },
  'admin.history.retimeTitle': {
    description: 'Title of the dialog changing a change set’s timestamp.',
  },
  'admin.history.retimeLabel': {
    description: 'Field label of the retime dialog. ISO-8601 is a date format standard.',
  },
  'admin.history.retimeConfirm': { description: 'Confirm button of the retime dialog.' },
  'admin.history.retimeInvalid': {
    description:
      'Validation error when the typed timestamp is not a valid ISO-8601 instant. The example is a literal.',
  },
  'admin.history.loadListsFailed': {
    description:
      'Error when the list of lists could not be fetched. {reason} is the underlying failure.',
  },
  'admin.history.loadFailed': {
    description: 'Error when one list’s change history could not be fetched. {name} is the list.',
  },
  'admin.history.saveFailed': {
    description: 'Error when the edited change history could not be written.',
  },

  // ── Import Changes ────────────────────────────────────────────────────
  'admin.importChanges.desc': {
    description:
      'Lead paragraph of the Import Changes page. A "change bundle" is a JSON file exported from the site editor.',
  },
  'admin.importChanges.applyFailed': { description: 'Error when the bundle could not be applied.' },
  'admin.importChanges.applied': {
    description: 'Fallback success message when the import worked but reported no summary.',
  },
  'admin.importChanges.appliedCount': {
    description:
      'Per-list result: how many changes were written to that list. A sentence fragment following the list’s name.',
  },
  'admin.importChanges.skipped': {
    description:
      'Per-change result: the change was not applied. {reason} is one of the domain.importConflict.* phrases saying why, and {change} is a rendered change line.',
  },
  'admin.importChanges.sourceLabel': { description: 'Accessible name of the upload/paste tabs.' },
  'admin.importChanges.fileLabel': { description: 'Field label of the bundle file picker.' },
  'admin.importChanges.fileHint': { description: 'Hint naming where such a file comes from.' },
  'admin.importChanges.textLabel': {
    description: 'Field label of the box the bundle JSON is pasted into.',
  },
  'admin.importChanges.invalid': {
    description:
      'Error when the supplied text is not a valid bundle. {reason} is the parser’s own message.',
  },
  'admin.importChanges.pendingLabel': {
    description:
      'Heading over the preview. {changes} and {lists} are already-rendered counted phrases such as "12 changes" and "3 lists".',
  },
  'admin.importChanges.previewList': {
    description:
      'One list’s preview heading. {slug} is the file name (never translated) and {changes} an already-rendered counted phrase. One branch per list type.',
  },
  'admin.importChanges.previewMoves': {
    description:
      'Heading over the preview group of cross-list moves (a bundle records each move once, with a source and a destination list). {moves} is an already-rendered counted phrase such as "2 moves".',
  },
  'admin.importChanges.previewMove': {
    description:
      'One move in the preview. {from} is the source list’s name and {change} a rendered change line such as "Move Sol Ring (C19:221) to collection ‘Binder’".',
  },
  'admin.importChanges.previewReplacement': {
    description:
      'Appended to a move’s preview line when the source list gets a printing back for the copy taken (the swap wizard’s "replace taken copies"). {list} is the source list’s name and {change} a rendered add line such as "Add Sol Ring (C21:263)".',
  },
  'admin.importChanges.applying': {
    description: 'Button label while the bundle is being applied.',
  },
  'admin.importChanges.applyButton': {
    description:
      'Button that applies the bundle. {changes} and {lists} are already-rendered counted phrases.',
  },

  // ── Import Deck ───────────────────────────────────────────────────────
  'admin.importDeck.methodLabel': { description: 'Accessible name of the URL/upload/paste tabs.' },
  'admin.importDeck.methodUrl': {
    description: 'Tab choosing to import a deck from a web address.',
  },
  'admin.importDeck.urlLabel': { description: 'Field label for the deck’s web address.' },
  'admin.importDeck.urlHint': {
    description: 'Hint naming the deck sites whose URLs are understood. All three are brand names.',
  },
  'admin.importDeck.fileLabel': { description: 'Field label of the deck file picker.' },
  'admin.importDeck.fileHint': {
    description: 'Hint describing what kind of file the picker accepts.',
  },
  'admin.importDeck.textLabel': {
    description: 'Field label of the box a decklist is pasted into.',
  },
  'admin.importDeck.textHint': {
    description:
      'Hint describing the accepted decklist syntax. {syntax} and {heading} are literal code samples rendered as code.',
  },
  'admin.importDeck.qtyName': {
    description:
      'The literal line syntax named by admin.importDeck.textHint. QTY stands for a number; only translate it if a translated placeholder still reads as a placeholder.',
  },
  'admin.importDeck.headingSyntax': {
    description:
      'The literal Markdown heading syntax named by admin.importDeck.textHint. Never translate.',
  },
  'admin.importDeck.nameLabel': {
    description: 'Field label for the name the imported deck will take.',
  },
  'admin.importDeck.namePlaceholder': {
    description: 'Placeholder name used when none is supplied.',
  },
  'admin.importDeck.nameHint': {
    description: 'Hint saying the typed name is a fallback: a name inside the text wins.',
  },
  'admin.importDeck.syncPrintings': {
    description:
      'Checkbox on a URL import: keep the exact printings (specific editions and foil/etched finishes) the deck site states, or import bare card names. Ticked by default.',
  },
  'admin.importDeck.overwrite': {
    description: 'Checkbox allowing the import to replace a deck of the same name.',
  },
  'admin.importDeck.import': { description: 'Submit button of the deck import form.' },
  'admin.importDeck.failed': {
    description: 'Error when the deck import request failed without a message.',
  },

  // ── Import CSV ────────────────────────────────────────────────────────
  'admin.importCsv.sourceLabel': { description: 'Accessible name of the upload/paste tabs.' },
  'admin.importCsv.fileLabel': { description: 'Field label of the CSV file picker.' },
  'admin.importCsv.fileHint': {
    description: 'Hint naming apps whose CSV exports are understood. All are brand names.',
  },
  'admin.importCsv.textLabel': { description: 'Field label of the box CSV text is pasted into.' },
  'admin.importCsv.parseFailed': {
    description: 'Error when the CSV could not be parsed. {reason} is the parser’s own message.',
  },
  'admin.importCsv.failuresLead': {
    description:
      'Lead of the list of rows the import refused. {count} is how many rows. Ends with a colon.',
  },
  'admin.importCsv.failureRow': {
    description:
      'One refused row: {line} is its line number, {raw} the row itself rendered as code, {reason} why it was refused.',
  },
  'admin.importCsv.hasHeader': {
    description:
      'Checkbox saying the first row of the file names the columns rather than holding data.',
  },
  'admin.importCsv.mappingLabel': {
    description: 'Heading of the controls pairing each card field with a column of the file.',
  },
  'admin.importCsv.optional': {
    description: 'Marks a field the import can do without. Includes its own parentheses.',
  },
  'admin.importCsv.notInFile': {
    description:
      'Dropdown option meaning the file has no column for this field. Includes its own parentheses.',
  },
  'admin.importCsv.selectColumn': {
    description: 'Placeholder option of a required field’s column dropdown.',
  },
  'admin.importCsv.chooseNameColumn': {
    description:
      'Validation message: the card-name column is the one mapping that cannot be omitted.',
  },
  'admin.importCsv.rowsHint': {
    description:
      'How many data rows were found, plus a note that values are normalized. The arrows show example normalizations and are literal.',
  },
  'admin.importCsv.column': {
    description: 'Dropdown option naming a column of a headerless file. {index} is 1-based.',
  },
  'admin.importCsv.columnWithHeader': {
    description:
      'Dropdown option naming a column by its header. {index} is 1-based, {header} the header cell.',
  },
  'admin.importCsv.columnSample': {
    description:
      'Adds an example value to a column option. {label} is admin.importCsv.column or admin.importCsv.columnWithHeader.',
  },
  'admin.importCsv.importIntoLabel': {
    description: 'Field label choosing which kind of list the rows become.',
  },
  'admin.importCsv.modeLabel': { description: 'Accessible name of the create/append tabs.' },
  'admin.importCsv.modeCreate': {
    description: 'Tab choosing to put the rows into a brand-new list.',
  },
  'admin.importCsv.modeAppend': {
    description: 'Tab choosing to add the rows to a list that already exists.',
  },
  'admin.importCsv.nameLabel': { description: 'Field label for the new list’s name.' },
  'admin.importCsv.namePlaceholder': {
    description: 'Example list name. A "binder" is where collectors keep cards.',
  },
  'admin.importCsv.formatLabel': { description: 'Field label choosing a new deck’s game format.' },
  'admin.importCsv.overwrite': {
    description: 'Checkbox allowing the import to replace a list of the same name.',
  },
  'admin.importCsv.targetLabel': {
    description: 'Field label choosing which existing list the rows are appended to.',
  },
  'admin.importCsv.selectList': { description: 'Placeholder option of the target-list dropdown.' },
  'admin.importCsv.noLists': {
    description:
      'Shown when append mode is chosen but no list of that type exists yet. One branch per list type.',
  },
  'admin.importCsv.appendCards': {
    description: 'Submit button when appending to an existing list.',
  },
  'admin.importCsv.import': { description: 'Submit button when creating a new list.' },
  'admin.importCsv.failed': {
    description: 'Error when the CSV import request failed without a message.',
  },

  // ── Manage Lists ──────────────────────────────────────────────────────
  'admin.list.newButton': {
    description:
      'Button opening the create form. The leading + is decoration. One branch per list type — translate each as a whole phrase.',
  },
  'admin.list.nameLabel': {
    description: 'Field label for a new list’s name. One branch per list type.',
  },
  'admin.list.createButton': {
    description: 'Submit button of the create form. One branch per list type.',
  },
  'admin.list.renameTitle': {
    description: 'Heading of the rename form. One branch per list type.',
  },
  'admin.list.deleteTitle': {
    description: 'Heading of the delete form. One branch per list type.',
  },
  'admin.list.deleteButton': {
    description: 'Submit button of the delete form. One branch per list type.',
  },
  'admin.list.namePlaceholder': {
    description:
      'Example name shown in the empty name field. One branch per list type; invent an example that reads naturally in your language.',
  },
  'admin.list.visibilityTitle': {
    description:
      'Tooltip of the toggle that publishes or hides a list on the public site. One branch per list type.',
  },
  'admin.list.loadFailed': {
    description: 'Error when a category’s lists could not be fetched. One branch per list type.',
  },
  'admin.list.createFailed': {
    description: 'Error when a list could not be created. One branch per list type.',
  },
  'admin.list.renameFailed': {
    description: 'Error when a list could not be renamed. One branch per list type.',
  },
  'admin.list.deleteFailed': {
    description: 'Error when a list could not be deleted. One branch per list type.',
  },
  'admin.list.visibilityFailed': {
    description:
      'Error when the public/hidden toggle could not be saved. One branch per list type.',
  },
  'admin.list.empty': {
    description: 'Shown when a category holds no lists. One branch per list type.',
  },
  'admin.list.deleteWarning': {
    description:
      'Warning above the delete confirmation. {name} is the list, shown in bold. Only a deck has a primer, which is why the deck branch names one more file.',
  },
  'admin.list.nowHidden': {
    description:
      'Status after hiding a list from the public site. {name} appears in straight quotes.',
  },
  'admin.list.nowVisible': {
    description:
      'Status after publishing a list to the public site. {name} appears in straight quotes.',
  },
  'admin.list.unusableName': {
    description: 'Validation error when the typed name would produce an empty file name.',
  },
  'admin.list.fileNameHint': {
    description: 'Preview of the file the create form would write. {file} is rendered as code.',
  },
  'admin.list.newFileNameHint': {
    description: 'Preview of the file the rename form would write to. {file} is rendered as code.',
  },
  'admin.list.formatLabel': { description: 'Field label choosing a new deck’s game format.' },
  'admin.list.creating': { description: 'Button label while a list is being created.' },
  'admin.list.renaming': { description: 'Button label while a list is being renamed.' },
  'admin.list.deleting': { description: 'Button label while a list is being deleted.' },
  'admin.list.rename': {
    description: 'Row action opening the rename form, and the rename form’s own submit button.',
  },
  'admin.list.edit': { description: 'Row action that opens the list in the editor.' },
  'admin.list.delete': { description: 'Row action opening the delete form.' },
  'admin.list.public': { description: 'Toggle state: the list appears on the public site.' },
  'admin.list.hidden': { description: 'Toggle state: the list is kept off the public site.' },
  'admin.list.newNameLabel': {
    description: 'Field label for the replacement name in the rename form.',
  },
  'admin.list.renamingWhich': {
    description: 'Names the list being renamed. {name} is shown in bold.',
  },
  'admin.list.deleteConfirmLabel': {
    description: 'Instruction to retype the list’s name before deleting. {name} is shown in bold.',
  },

  // ── Move Cards ────────────────────────────────────────────────────────
  'admin.moveCards.selectorLabel': {
    description: 'Label of the dropdown choosing which list to browse for cards to move.',
  },
  'admin.moveCards.searchLabel': {
    description: 'Label of the search box that looks across every enabled list.',
  },
  'admin.moveCards.searchPlaceholder': {
    description: 'Placeholder of the cross-list card search box.',
  },
  'admin.moveCards.filters': {
    description: 'Button expanding the per-list source/destination filters.',
  },
  'admin.moveCards.pending': {
    description: 'Button opening the list of queued but uncommitted moves.',
  },
  'admin.moveCards.saving': { description: 'Button label while queued moves are being written.' },
  'admin.moveCards.save': {
    description: 'Button that commits every queued move to the list files.',
  },
  'admin.moveCards.discard': { description: 'Button that throws away every queued move.' },
  'admin.moveCards.loadingLists': { description: 'Placeholder while the lists load.' },
  'admin.moveCards.empty': {
    description: 'Empty state before a list is browsed or a search is typed.',
  },
  'admin.moveCards.loadingList': {
    description: 'Placeholder while one list’s cards load. {name} is the list.',
  },
  'admin.moveCards.quantityTitle': {
    description: 'Title of the dialog asking how many copies to move.',
  },
  'admin.moveCards.quantityMessage': {
    description:
      'Body of the quantity dialog when the destination is not yet named. {total} is how many copies are available.',
  },
  'admin.moveCards.quantityMessageTo': {
    description: 'Body of the quantity dialog naming the destination list in {dest}.',
  },
  'admin.moveCards.moveConfirm': { description: 'Confirm button of the quantity dialog.' },
  'admin.moveCards.leaveTitle': {
    description: 'Title of the confirmation shown when leaving the page with moves still queued.',
  },
  'admin.moveCards.leaveConfirm': {
    description: 'Confirm button that leaves the page and drops the queued moves.',
  },
  'admin.moveMenu.label': {
    description: 'Accessible name of the destination popup for one card. {name} is the card.',
  },
  'admin.moveMenu.empty': {
    description: 'Shown in the destination popup when every other list is filtered out.',
  },
  'admin.moveFilters.help': {
    description:
      'Explains the two columns of tick boxes. {from} and {to} are the bolded words "from" and "to" — keep them where the emphasis belongs in your language.',
  },
  'admin.moveFilters.fromWord': {
    description: 'The bolded {from} of admin.moveFilters.help: the source side.',
  },
  'admin.moveFilters.toWord': {
    description: 'The bolded {to} of admin.moveFilters.help: the destination side.',
  },
  'admin.moveFilters.fromLabel': {
    description: 'Label before the bulk buttons for the source column. Ends with a colon.',
  },
  'admin.moveFilters.toLabel': {
    description: 'Label before the bulk buttons for the destination column. Ends with a colon.',
  },
  'admin.moveFilters.all': {
    description: 'Bulk button ticking every list in a column.',
    maxLen: 8,
  },
  'admin.moveFilters.none': {
    description: 'Bulk button unticking every list in a column.',
    maxLen: 8,
  },
  'admin.moveFilters.colList': { description: 'Column header naming the list each row is about.' },
  'admin.moveFilters.colFrom': {
    description: 'Column header of the source tick boxes.',
    maxLen: 10,
  },
  'admin.moveFilters.colTo': {
    description: 'Column header of the destination tick boxes.',
    maxLen: 10,
  },
  'admin.moveFilters.moveFrom': {
    description: 'Accessible name of one source tick box. {name} is the list.',
  },
  'admin.moveFilters.moveTo': {
    description: 'Accessible name of one destination tick box. {name} is the list.',
  },
  'admin.moveFilters.noLists': {
    description: 'Shown in the filters panel when the workspace holds no lists at all.',
  },
  'admin.movePending.title': {
    description: 'Title of the queued-moves dialog. {count} is how many moves are queued.',
  },
  'admin.movePending.empty': {
    description: 'Shown in the queued-moves dialog when nothing is queued.',
  },
  'admin.movePending.discard': { description: 'Row button removing one queued move.' },
  'admin.movePending.discardOne': {
    description: 'Accessible name of the row button. {name} is the card.',
  },
  'admin.movePending.discardAll': { description: 'Button removing every queued move at once.' },
  'admin.moveSearch.empty': {
    description:
      'Shown when the cross-list search matched nothing. {query} is what was typed, in curly quotes.',
  },
  'admin.moveSearch.moveLabel': {
    description:
      'Accessible name of a search row, which opens the destination popup. {name} is the card.',
  },
  'admin.move.nothingToMove': {
    description:
      'Result when every selected card was dropped before a move was sent — already on the destination, or its printing prompt was skipped.',
  },
  'admin.move.loadListsFailed': {
    description:
      'Error when the Move Cards page could not load its lists. {reason} is the underlying failure.',
  },
  'admin.move.loadListFailed': {
    description: 'Error when one list’s cards could not be loaded. {name} is the list.',
  },
  'admin.move.loadListFailedReason': {
    description: 'admin.move.loadListFailed with the underlying failure appended.',
  },
  'admin.move.skippedSuffix': {
    description:
      'Appended to admin.api.move.moved: copies the commit stepped over. **Keep the leading space** — it separates this clause from the one before it.',
  },
  'admin.move.saveFailed': {
    description:
      'Error when queued moves could not be written. {reason} is the underlying failure.',
  },

  // ── Sync Decks page ───────────────────────────────────────────────────
  'admin.deckSync.desc': { description: 'Lead paragraph of the Sync Decks page.' },
  'admin.deckSync.loading': { description: 'Placeholder while the Archidekt-linked decks load.' },
  'admin.deckSync.loadFailed': {
    description: 'Error when the Archidekt-linked decks could not be loaded.',
  },
  'admin.deckSync.none': { description: 'Empty state when no deck is linked to Archidekt.' },
  'admin.deckSync.neverAny': {
    description: 'Shown in place of a time when no deck has ever been synced.',
  },
  'admin.deckSync.pullDesc': {
    description: 'Explanation of the pull direction on the Sync Decks page. The arrow is literal.',
  },
  'admin.deckSync.pushDesc': {
    description: 'Explanation of the push direction on the Sync Decks page. The arrow is literal.',
  },
  'admin.deckSync.decksHeading': { description: 'Heading above the per-deck tick boxes.' },
  'admin.deckSync.allDecks': {
    description: 'Label of the tick box that selects every deck at once.',
  },
  'admin.deckSync.selectedCount': { description: 'How many decks are ticked. {count} of {total}.' },
  'admin.deckSync.syncPrintings': {
    description:
      'Tick box making the run also sync each card\'s exact printing. "Printing" is a specific edition of a card; "finish" is its foil/etched treatment.',
  },
  'admin.deckSync.dryRun': {
    description: 'Tick box making the run report what it would do without changing anything.',
  },
  'admin.deckSync.signInPrompt': {
    description: 'Explains why the run button is unavailable: Archidekt sign-in is needed first.',
  },
  'admin.deckSync.confirmUnreadable': {
    description: 'Button consenting to a run that will delete deck lines Ritual could not parse.',
  },
  'admin.deckSync.failed': {
    description: 'Error when a deck sync run failed without a message of its own.',
  },

  // ── Sync Collection page ──────────────────────────────────────────────
  'admin.collectionSync.desc': { description: 'Lead paragraph of the Sync Collection page.' },
  'admin.collectionSync.loading': { description: 'Placeholder while the collection lists load.' },
  'admin.collectionSync.loadFailed': {
    description: 'Error when the collection lists could not be loaded.',
  },
  'admin.collectionSync.neverAny': {
    description: 'Shown in place of a time when this account has never synced.',
  },
  'admin.collectionSync.pullDesc': {
    description:
      'Explanation of the pull direction on the Sync Collection page, including why a removal can be unplaceable. The arrow is literal.',
  },
  'admin.collectionSync.pushDesc': {
    description:
      'Explanation of the push direction on the Sync Collection page. The arrow is literal.',
  },
  'admin.collectionSync.scopeHeading': {
    description: 'Heading of the control choosing how much of the collection a run covers.',
  },
  'admin.collectionSync.scopeLabel': { description: 'Accessible name of the scope control.' },
  'admin.collectionSync.scopeAll': { description: 'Scope option: compare every collection list.' },
  'admin.collectionSync.scopeAllDesc': {
    description: 'Explanation under the "Whole collection" scope option.',
  },
  'admin.collectionSync.scopeLists': {
    description: 'Scope option: compare only the ticked lists.',
  },
  'admin.collectionSync.scopeListsDesc': {
    description:
      'Explanation under the "Selected lists" scope option, warning that the remote side is still the whole collection.',
  },
  'admin.collectionSync.noLists': {
    description: 'Shown when the selected-lists scope is chosen but no collection list exists.',
  },
  'admin.collectionSync.intoHeading': {
    description: 'Heading of the control choosing which list a pull puts brand-new cards in.',
  },
  'admin.collectionSync.intoDesc': {
    description:
      'Explains the pull target. {emphasis} is an italicised word; {setting} is a config key rendered as code — never translate the key.',
  },
  'admin.collectionSync.intoDescEmphasis': {
    description:
      'The italicised {emphasis} of admin.collectionSync.intoDesc: some list, but nobody can say which.',
  },
  'admin.collectionSync.intoSetting': {
    description:
      'The config key named by admin.collectionSync.intoDesc. A literal key — never translate.',
  },
  'admin.collectionSync.intoLabel': { description: 'Accessible name of the pull-target dropdown.' },
  'admin.collectionSync.willBeCreated': {
    description:
      'Dropdown option for a configured target that does not exist yet; the pull would create it. {name} is the list name.',
  },
  'admin.collectionSync.dryRun': {
    description: 'Tick box making the run report what it would do without changing anything.',
  },
  'admin.collectionSync.signInPrompt': {
    description:
      'Explains why the run button is unavailable. {link} is a link to the Archidekt Login page.',
  },
  'admin.collectionSync.confirmUnreadable': {
    description:
      'Button consenting to a run that will lose collection lines Ritual could not parse.',
  },
  'admin.collectionSync.failed': {
    description: 'Error when a collection sync run failed without a message of its own.',
  },
  'admin.collectionSync.resultMeta': {
    description: 'One list’s tally beside its row. The + and - are literal signs on the counts.',
  },

  // ── Removal priority ──────────────────────────────────────────────────
  'admin.priority.heading': {
    description:
      'Heading of the control ranking which lists may give copies up when a removal is ambiguous.',
  },
  'admin.priority.desc': {
    description: 'Explains why a priority is needed and what the order means.',
  },
  'admin.priority.descRun': {
    description: 'Consequence of no priority on a real run. {emphasis} is bolded.',
  },
  'admin.priority.descPreview': {
    description: 'Consequence of no priority when previewing. {emphasis} is bolded.',
  },
  'admin.priority.failsAndWritesNothing': {
    description:
      'The bolded {emphasis} of admin.priority.descRun and .descPreview: the run stops and no file changes.',
  },
  'admin.priority.emptyPreview': { description: 'Shown under an empty priority while previewing.' },
  'admin.priority.emptyRun': { description: 'Shown under an empty priority for a real run.' },
  'admin.priority.remove': {
    description:
      'Accessible name of the × that drops a list from the priority. {name} is the list.',
  },
  'admin.priority.noLists': {
    description: 'Shown when the run’s scope contains no collection list to rank.',
  },

  // ── CSV upload toggle and outcome ─────────────────────────────────────
  'admin.csvToggle.heading': {
    description:
      'Heading of the control choosing how a push sends cards Archidekt does not have yet.',
  },
  'admin.csvToggle.desc': { description: 'Explains why one CSV import beats a request per card.' },
  'admin.csvToggle.label': { description: 'The tick box itself.' },
  'admin.csvToggle.thresholdFew': {
    description:
      'Stands in for the threshold number before the server has reported it. A vague quantity on purpose.',
  },
  'admin.csvToggle.offRun': {
    description:
      'Warning shown when the CSV upload is switched off for a real push. {threshold} is a number, {emphasis} a bolded clause.',
  },
  'admin.csvToggle.offPreview': {
    description:
      'admin.csvToggle.offRun while previewing. {real} is an italicised word distinguishing a real push from this preview.',
  },
  'admin.csvToggle.offPreviewReal': {
    description: 'The italicised {real} of admin.csvToggle.offPreview.',
  },
  'admin.csvToggle.failsWithoutPushing': {
    description:
      'The bolded {emphasis} of admin.csvToggle.offRun and .offPreview: the push stops and Archidekt is untouched.',
  },
  'admin.csvOutcome.unconfirmed': {
    description:
      'Follows the upload summary: Archidekt answered some requests in a form the run could not read, so those rows are assumed imported. {count} is how many requests.',
  },
  'admin.csvOutcome.exported': {
    description:
      'Outcome: the rows were written to a file instead of uploaded. {size} is a rendered phrase like "12 cards (14 rows)"; {path} is a file path rendered as code.',
  },
  'admin.csvOutcome.plannedUpload': {
    description: 'Preview outcome: what the upload would have carried.',
  },
  'admin.csvOutcome.plannedExport': {
    description: 'Preview outcome: what would have been written to a file instead.',
  },
  'admin.csvOutcome.failed': {
    description:
      'Outcome: Archidekt refused the whole import. {message} is its own reason and already ends in punctuation.',
  },
  'admin.csvOutcome.empty': {
    description:
      'Outcome: no row could be built because no new card has a printing in the local cache. {command} is a CLI command rendered as code.',
  },
  'admin.csvOutcome.emptyCommand': {
    description:
      'The CLI command named by admin.csvOutcome.empty. A literal command — never translate.',
  },
  'admin.csvOutcome.failuresLead': {
    description:
      'How many rows Archidekt refused. {reasons} is either empty or a parenthesised summary, so no punctuation belongs before it.',
  },
  'admin.csvOutcome.failure': { description: 'One refused row: the card and Archidekt’s reason.' },

  // ── Settings ──────────────────────────────────────────────────────────
  'admin.settings.save': { description: 'Button that persists the admin Settings form.' },
  'admin.settings.saved': {
    description: 'Success alert shown after the admin Settings form is persisted.',
  },
  'admin.settings.loading': { description: 'Placeholder while the configuration loads.' },
  'admin.settings.loadFailed': { description: 'Error when the configuration could not be loaded.' },
  'admin.settings.saveFailed': { description: 'Error when the configuration could not be saved.' },
  'admin.settings.saving': { description: 'Button label while the configuration is being saved.' },
  'admin.settings.decksDir': { description: 'Field label: the folder holding deck files.' },
  'admin.settings.decksDirPlaceholder': {
    description: 'Example value for the decks folder. A literal path.',
  },
  'admin.settings.collectionsDir': {
    description: 'Field label: the folder holding collection files.',
  },
  'admin.settings.collectionsDirPlaceholder': {
    description: 'Example value for the collections folder. A literal path.',
  },
  'admin.settings.wantedDir': { description: 'Field label: the folder holding wanted-list files.' },
  'admin.settings.wantedDirPlaceholder': {
    description: 'Example value for the wanted-list folder. A literal path.',
  },
  'admin.settings.artDir': {
    description: 'Field label: the folder holding local images used as custom card art.',
  },
  'admin.settings.artDirPlaceholder': {
    description: 'Example value for the custom-art folder. A literal path.',
  },
  'admin.settings.artDirHint': {
    description:
      'Explains the custom-art folder: images placed there can replace a card’s printing image, and a card refers to one by its path relative to this folder.',
  },
  'admin.settings.defaultCurrency': {
    description: 'Field label: which currency prices are shown in.',
  },
  'admin.settings.currencyUsd': {
    description: 'Currency option: US dollars, priced from TCGplayer (a marketplace name).',
  },
  'admin.settings.currencyEur': {
    description: 'Currency option: euros, priced from Cardmarket (a marketplace name).',
  },
  'admin.settings.priceSources': {
    description:
      'Label above the checkbox group choosing which stores the sites offer card prices from.',
  },
  'admin.settings.priceSourcesHint': {
    description:
      'Hint under the price-stores checkboxes explaining the USD/EUR store split, that unchecking all hides prices entirely, and the Card Kingdom feed download cost. Store and mode names (TCGplayer, Card Kingdom, Cardmarket, sell mode) refer to the labeled controls.',
  },
  'admin.settings.currencyTix': {
    description: 'Currency option: Magic Online event tickets, the currency of MTGO.',
  },
  'admin.settings.defaultLanguage': {
    description:
      'Field label: which language *printing* of a card is recorded. Not the interface language — see admin.settings.uiLocale.',
  },
  'admin.settings.languageOption': {
    description:
      'One card-language option: its name and its Scryfall code. The code is never translated.',
  },
  'admin.settings.defaultLanguageHint': {
    description:
      'Explains the cost of a non-English card language and that an untagged line always means English.',
  },
  'admin.settings.uiLocale': {
    description: 'Field label: which language Ritual’s own interface speaks.',
  },
  'admin.settings.uiLocaleHint': {
    description:
      'Explains that the interface language and the card language are independent settings.',
  },
  'admin.settings.uiLocaleOption': {
    description:
      'One interface-language option: its name in its own language and its BCP-47 tag. The tag is never translated.',
  },
  'admin.settings.cacheSource': {
    description: 'Field label: where bulk card data is fetched from.',
  },
  'admin.settings.cacheSourceScryfall': {
    description: 'Cache source option: download straight from Scryfall (a card database).',
  },
  'admin.settings.cacheSourceFeed': {
    description: 'Cache source option: fetch from a peer-to-peer feed instead.',
  },
  'admin.settings.cacheFeedUrl': {
    description: 'Field label: the address of the peer-to-peer cache feed.',
  },
  'admin.settings.cacheFeedUrlPlaceholder': {
    description: 'Placeholder for the feed address; only the parenthetical is prose.',
  },
  'admin.settings.cacheLockTimeout': {
    description: 'Field label: how long a cache write may hold its lock, in seconds.',
  },
  'admin.settings.cacheLockTimeoutPlaceholder': {
    description: 'Example value for the lock timeout.',
  },
  'admin.settings.searchDebounce': {
    description: 'Field label: how long the card search waits after a keystroke, in milliseconds.',
  },
  'admin.settings.searchDebouncePlaceholder': {
    description: 'Example value for the search debounce.',
  },
  'admin.settings.searchDebounceHint': {
    description:
      'Explains the debounce and notes it reaches the public site only at the next build.',
  },
  'admin.settings.gitHeading': { description: 'Section heading for the version-control settings.' },
  'admin.settings.gitEnabled': { description: 'Tick box switching git integration on.' },
  'admin.settings.gitAutoCommit': {
    description: 'Tick box committing every admin change automatically.',
  },
  'admin.settings.gitAutoPush': {
    description: 'Tick box pushing each automatic commit to the remote.',
  },
  'admin.settings.gitHint': { description: 'Explains what the git tick boxes do.' },
  'admin.settings.networkHeading': {
    description: 'Section heading for the proxy and cookie settings.',
  },
  'admin.settings.trustProxy': { description: 'Tick box trusting forwarded-address headers.' },
  'admin.settings.trustProxyHint': {
    description: 'Explains when to trust proxy headers. nginx and Caddy are product names.',
  },
  'admin.settings.secureCookies': { description: 'Tick box restricting session cookies to HTTPS.' },
  'admin.settings.secureCookiesHint': {
    description: 'Explains when to restrict cookies to HTTPS.',
  },
  'admin.settings.totpHeading': { description: 'Section heading for two-factor authentication.' },
  'admin.settings.rateLimitHeading': { description: 'Section heading for sign-in rate limiting.' },
  'admin.settings.rateLimitEnabled': {
    description: 'Tick box switching sign-in rate limiting on.',
  },
  'admin.settings.rateLimitMax': {
    description: 'Field label: how many failures are allowed before a lockout.',
  },
  'admin.settings.rateLimitWindow': {
    description: 'Field label: how long a lockout lasts, in minutes.',
  },
  'admin.settings.failedAuthDelay': {
    description: 'Field label: how long to wait before answering a bad sign-in, in milliseconds.',
  },
  'admin.settings.failedAuthDelayHint': { description: 'Explains why a deliberate delay helps.' },
  'admin.settings.ipHeading': { description: 'Section heading for network-address filtering.' },
  'admin.settings.ipHint': {
    description: 'Explains the syntax of both address lists and what an empty list means.',
  },
  'admin.settings.ipAllow': { description: 'Field label: addresses that may connect.' },
  'admin.settings.ipAllowPlaceholder': { description: 'Example address pattern.' },
  'admin.settings.ipDeny': { description: 'Field label: addresses that may not connect.' },
  'admin.settings.ipDenyPlaceholder': { description: 'Example address.' },
  'admin.settings.uaHeading': { description: 'Section heading for browser/tool filtering.' },
  'admin.settings.uaHint': { description: 'Explains the syntax of both user-agent lists.' },
  'admin.settings.uaAllow': { description: 'Field label: browsers or tools that may connect.' },
  'admin.settings.uaAllowPlaceholder': { description: 'Example user-agent pattern.' },
  'admin.settings.uaDeny': { description: 'Field label: browsers or tools that may not connect.' },
  'admin.settings.uaDenyPlaceholder': { description: 'Example user-agent pattern.' },
  'admin.settings.publicSiteHeading': {
    description: 'Section heading for what the published site contains.',
  },
  'admin.settings.publishHint': {
    description:
      'Explains the publish lists. {all} is the literal wildcard token, rendered as code — never translate it.',
  },
  'admin.settings.includeDecks': {
    description: 'Field label: which decks the public site publishes.',
  },
  'admin.settings.includeCollections': {
    description: 'Field label: which collections the public site publishes.',
  },
  'admin.settings.includeWanted': {
    description: 'Field label: which wanted lists the public site publishes.',
  },
  'admin.settings.excludeHint': {
    description: 'Explains that the exclude lists win over the publish lists above.',
  },
  'admin.settings.excludeDecks': { description: 'Field label: decks kept off the public site.' },
  'admin.settings.excludeCollections': {
    description: 'Field label: collections kept off the public site.',
  },
  'admin.settings.excludeWanted': {
    description: 'Field label: wanted lists kept off the public site.',
  },
  'admin.settings.apiBaseUrlHint': {
    description:
      'Explains the split deployment. {command} is a CLI command rendered as code — never translate it.',
  },
  'admin.settings.apiBaseUrlCommand': {
    description:
      'The CLI command named by admin.settings.apiBaseUrlHint. A literal command — never translate.',
  },
  'admin.settings.apiBaseUrl': { description: 'Field label: the address of the live backend.' },
  'admin.settings.apiBaseUrlPlaceholder': { description: 'Example backend address.' },
  'admin.settings.sellMode': {
    description:
      'Checkbox label: whether the sites offer sell mode (Card Kingdom buy prices and the buylist controls).',
  },
  'admin.settings.sellModeHint': {
    description:
      'Explains what the sell mode checkbox governs, why it is off by default, and that it applies without a restart. {flag} is a CLI flag rendered as code — never translate it.',
  },
  'admin.settings.sellModeFlag': {
    description:
      'The CLI flag named by admin.settings.sellModeHint. A literal flag — never translate.',
  },
  'admin.settings.printingsHeading': {
    description: 'Section heading for printings that may never be chosen as a card’s default.',
  },
  'admin.settings.printingsHint': {
    description:
      'Explains the banned-printings list. {format} and {example} are literal code samples.',
  },
  'admin.settings.printingsFormat': {
    description: 'The literal entry format named by admin.settings.printingsHint. Never translate.',
  },
  'admin.settings.printingsExample': { description: 'A literal example entry. Never translate.' },
  'admin.settings.bannedPrintings': {
    description: 'Field label: the banned default printings themselves.',
  },
  'admin.settings.bannedPrintingsPlaceholder': { description: 'Example banned printing.' },

  // ── admin.api.* ───────────────────────────────────────────────────────
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
      'Success alert after a list is deleted. {name} is the title it had. One branch per list type; see admin.api.list.created.',
  },
  'admin.api.save.saved': {
    description:
      'Success alert after an editor save. {count} is how many individual changes were written, {name} the list they were written to. Deliberately not a plural table: the English wording is fixed by the response MCP clients already read.',
  },
  'admin.api.save.artUnreconciled': {
    description:
      "Warning in an editor save's response when the list's (or a move destination's) <list>.art.json custom-art sidecar could not be read, so the &N ids the save freed or renumbered could not be re-filed. {reason} is untranslated engine prose naming the file and the parse failure. A warning, never a failure: the card lines were written correctly.",
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
} as const satisfies MetaFor<typeof adminMessages>
