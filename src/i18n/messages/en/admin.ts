/**
 * `admin.*` — admin-SPA chrome and the user-facing prose the admin API hands
 * back (via `messageKey`, so an alert relabels on a locale switch with no round
 * trip). MCP reuses those same handlers and reads the rendered English
 * `message` field, which never moves.
 */

import type { MessageCatalogShape } from '../../types'

export const adminMessages = {
  // ── App shell and layout ──────────────────────────────────────────────
  'admin.app.loading': 'Loading...',
  'admin.app.requestFailed': 'Request failed',
  'admin.layout.title': 'Ritual Admin',
  'admin.layout.logout': 'Logout',
  'admin.layout.toggleMenu': 'Toggle menu',
  'admin.layout.allSelected': 'All Selected',
  'admin.layout.clearSelections': 'Clear all selections',
  'admin.layout.removeSelectedTitle': 'Remove selected cards?',
  'admin.layout.removeSelectedConfirm': 'Remove',
  'admin.layout.actionFailedTitle': 'That did not work',
  'admin.layout.notesDroppedTitle': 'Some notes could not travel',
  'admin.layout.notesDropped': {
    $plural: 'count',
    one: 'The cards moved, but {count} note was lost when its card merged onto an existing line:',
    other:
      'The cards moved, but {count} notes were lost when their cards merged onto existing lines:',
  },
  'admin.layout.droppedNote': '{name}: "{note}"',

  // ── Shared controls ───────────────────────────────────────────────────
  'admin.select.chooseList': '— Choose a list —',
  'admin.import.upload': 'Upload File',
  'admin.import.pasteText': 'Paste Text',
  'admin.import.chooseFile': 'Choose File',
  'admin.import.noFile': 'No file selected',
  'admin.import.importing': 'Importing...',

  // ── Dashboard tiles ───────────────────────────────────────────────────
  //
  // Each tile's *title* comes from `domain.adminPage.*` (shared with the
  // sidebar and the page heading); only the longer description lives here.
  'admin.dashboard.listEditor': 'Edit decks, collections, and wanted lists',
  'admin.dashboard.moveCards': 'Move cards between decks, collections, and wanted lists',
  'admin.dashboard.listManager': 'Create, rename, and delete decks, collections, and wanted lists',
  'admin.dashboard.history': 'Compact and rewrite a list’s change log',
  'admin.dashboard.importDeck': 'Import a deck from a URL or file',
  'admin.dashboard.buildSite': 'Generate the static website',
  'admin.dashboard.cacheRefresh': 'Refresh the card data cache',
  'admin.dashboard.deckSync': 'Pull or push deck changes with Archidekt',
  'admin.dashboard.collectionSync': 'Pull or push collection changes with Archidekt',
  'admin.dashboard.archidektLogin': 'Sign in to Archidekt',
  'admin.dashboard.auditLog': 'View login and activity history',
  'admin.dashboard.settings': 'Configure admin settings',

  // ── Sign-in / first-run setup ─────────────────────────────────────────
  'admin.auth.signInSubtitle': 'Sign in to continue',
  'admin.auth.createSubtitle': 'Create your admin account',
  'admin.auth.username': 'Username',
  'admin.auth.password': 'Password',
  'admin.auth.totpCode': 'Two-Factor Code',
  'admin.auth.passwordHint': 'Password must be at least {count} characters.',
  'admin.auth.credentialsRequired': 'Username and password are required',
  'admin.auth.passwordTooShort': 'Password must be at least {count} characters',
  'admin.auth.totpRequired': 'Two-factor authentication code required',
  'admin.auth.totpInvalid': 'Invalid TOTP code',
  'admin.auth.invalidCredentials': 'Invalid username or password',
  'admin.auth.rateLimited': {
    $plural: 'count',
    one: 'Too many failed attempts. Try again in {count} minute.',
    other: 'Too many failed attempts. Try again in {count} minutes.',
  },
  'admin.auth.rateLimitedLater': 'Too many failed attempts. Try again later.',
  'admin.auth.setupLoginFailed': 'Account created but login failed. Try signing in.',
  'admin.auth.connectionFailed': 'Connection failed',
  'admin.auth.pleaseWait': 'Please wait...',
  'admin.auth.signIn': 'Sign In',
  'admin.auth.createAccount': 'Create Account',

  // ── TOTP enrollment (Settings) ────────────────────────────────────────
  'admin.totp.setupFailed': 'Setup failed',
  'admin.totp.startFailed': 'Failed to start TOTP setup',
  'admin.totp.enabled': 'TOTP enabled successfully. You will need to enter a code on next login.',
  'admin.totp.verifyFailed': 'Verification failed',
  'admin.totp.disabled': 'TOTP disabled',
  'admin.totp.disableFailed': 'Failed to disable TOTP',
  'admin.totp.statusEnabled': 'TOTP is enabled',
  'admin.totp.disabling': 'Disabling...',
  'admin.totp.disable': 'Disable TOTP',
  'admin.totp.addAccount': 'Add this account to your authenticator app:',
  'admin.totp.secretLabel': 'Secret key (manual entry):',
  'admin.totp.uriLabel': 'URI (for QR code generators):',
  'admin.totp.enterCode': 'Enter code from authenticator to verify:',
  'admin.totp.verifying': 'Verifying...',
  'admin.totp.verify': 'Verify & Enable',
  'admin.totp.settingUp': 'Setting up...',
  'admin.totp.setUp': 'Set Up TOTP',

  // ── Archidekt session ─────────────────────────────────────────────────
  'admin.archidekt.signedIn': 'Signed in as {username}.',
  'admin.archidekt.yourAccount': 'your Archidekt account',
  'admin.archidekt.notSignedIn':
    'Not signed in to Archidekt. Sign in below to use Archidekt account features.',
  'admin.archidekt.expired':
    'Your Archidekt session has expired. A login is required to use Archidekt account features.',
  'admin.archidekt.usernameLabel': 'Username or Email',
  'admin.archidekt.passwordLabel': 'Password',
  'admin.archidekt.loggingIn': 'Logging in...',
  'admin.archidekt.login': 'Login to Archidekt',
  'admin.archidekt.loginFailed': 'Login failed',
  'admin.archidektPage.desc':
    'Sign in to your Archidekt account. Credentials are sent securely to the server for authentication.',
  'admin.archidektPage.checking': 'Checking Archidekt login status…',
  'admin.archidektPage.statusUnavailable': 'Could not load Archidekt login status.',
  'admin.archidektPage.accessToken': 'Current login (access token)',
  'admin.archidektPage.refreshToken': 'Refresh token',
  'admin.archidektPage.willRefresh':
    'The access token has expired but will refresh automatically using the refresh token.',
  'admin.archidektPage.expiryValid': 'valid',
  'admin.archidektPage.expiryUnknown': 'expiration unknown',
  'admin.archidektPage.expiresIn': 'valid for {duration} (until {when})',
  'admin.archidektPage.expiredAgo': 'expired {duration} ago (on {when})',

  // ── Audit Log ─────────────────────────────────────────────────────────
  'admin.auditLog.loading': 'Loading audit log...',
  'admin.auditLog.loadFailed': 'Failed to load audit log',
  'admin.auditLog.refresh': 'Refresh',
  'admin.auditLog.empty': 'No login attempts recorded yet.',
  'admin.auditLog.colTime': 'Time',
  'admin.auditLog.colStatus': 'Status',
  'admin.auditLog.colUsername': 'Username',
  'admin.auditLog.colIp': 'IP',
  'admin.auditLog.colReason': 'Reason',
  'admin.auditLog.colUserAgent': 'User Agent',
  'admin.auditLog.success': 'Success',
  'admin.auditLog.failed': 'Failed',

  // ── Build Site ────────────────────────────────────────────────────────
  'admin.buildSite.desc':
    'Generate the static website from your deck files. This may take a few minutes.',
  'admin.buildSite.building': 'Building... (this may take a while)',
  'admin.buildSite.build': 'Build Site',
  'admin.buildSite.failed': 'Failed to build site',

  // ── Refresh Cache ─────────────────────────────────────────────────────
  'admin.cache.desc': 'Download and cache all Scryfall card data. This will take some time.',
  'admin.cache.stageDownload': 'Downloading & processing card data',
  'admin.cache.stageSave': 'Saving to cache',
  'admin.cache.fallbackProgress': 'Refreshing cache (progress unavailable)...',
  'admin.cache.refreshFailed': 'Failed to refresh cache',
  'admin.cache.streamFailed': 'Cache refresh failed',
  'admin.cache.refreshed': 'Cache refreshed successfully',
  'admin.cache.downloading': 'Downloading',
  'admin.cache.refreshing': 'Refreshing...',
  'admin.cache.refresh': 'Refresh Cache',

  // ── Card Kingdom buylist card (Refresh Cache page) ────────────────────
  'admin.buylist.title': 'Card Kingdom buylist',
  'admin.buylist.desc':
    'Card Kingdom’s pricelist feed (~70 MB), used by {command} and the public site’s sell mode. No page load downloads it; server startup refreshes a day-old copy, and this button forces one now.',
  'admin.buylist.command': 'ritual sell',
  'admin.buylist.empty':
    'No buylist has been downloaded yet. Refresh to fetch it for the first time.',
  'admin.buylist.statusFailed': 'Failed to read the buylist status',
  'admin.buylist.refreshFailed': 'Failed to refresh the buylist',
  'admin.buylist.notUpdated': 'The buylist was not updated.',
  'admin.buylist.updated': {
    $plural: 'count',
    one: 'Buylist updated — {count} product.',
    other: 'Buylist updated — {count} products.',
  },
  'admin.buylist.downloadedLabel': 'Downloaded',
  'admin.buylist.stale': '(stale)',
  'admin.buylist.stampLabel': 'Card Kingdom stamp',
  'admin.buylist.productsLabel': 'Products',
  'admin.buylist.downloading': 'Downloading…',
  'admin.buylist.refresh': 'Refresh buylist',

  // ── Collection default-labels modal ───────────────────────────────────
  'admin.labels.title': 'Default Labels',
  'admin.labels.desc':
    'The default for every card in this collection. Individual cards can override it with their own label.',
  'admin.labels.groupLabel': 'Default labels',
  'admin.labels.saveFailed': 'Save failed ({status})',
  'admin.labels.saving': 'Saving…',
  'admin.labels.save': 'Save',

  // ── Change History ────────────────────────────────────────────────────
  'admin.combine.title': 'Combine change sets',
  'admin.combine.message':
    'Choose a set to merge into {timestamp}. Its entries move in and it is then deleted; {timestamp} keeps its timestamp.',
  'admin.history.discardTitle': 'Discard unsaved changes?',
  'admin.history.discardMessage': 'Your edits to this change history will be lost.',
  'admin.history.discardConfirm': 'Discard',
  'admin.history.rewriteTitle': 'Rewrite with defaults?',
  'admin.history.rewriteMessage':
    'Replace all change sets with a single new set describing the list exactly as it stands now.',
  'admin.history.rewriteConfirm': 'Rewrite',
  'admin.history.discardAllTitle': 'Discard all changes?',
  'admin.history.discardAllMessage': 'Revert to the change history as it was loaded.',
  'admin.history.selectorLabel': 'Edit history for',
  'admin.history.rewriteButton': 'Rewrite with defaults',
  'admin.history.rewriteDisabled': 'The list is empty — nothing to rewrite from.',
  'admin.history.undo': 'Undo',
  'admin.history.saving': 'Saving...',
  'admin.history.save': 'Save',
  'admin.history.discard': 'Discard',
  'admin.history.loadingLists': 'Loading lists…',
  'admin.history.chooseList': 'Choose a list to edit its change history.',
  'admin.history.loading': 'Loading…',
  'admin.history.summary':
    'Change sets: {originalSets} → {sets} · Change lines: {originalLines} → {lines}',
  'admin.history.noHistory': 'This list has no change history.',
  'admin.history.noHistoryHint': 'Use {action} to generate one from its current contents.',
  'admin.history.combine': 'Combine',
  'admin.history.editTime': 'Edit time',
  'admin.history.delete': 'Delete',
  'admin.history.retimeTitle': 'Edit timestamp',
  'admin.history.retimeLabel': 'New ISO-8601 timestamp',
  'admin.history.retimeConfirm': 'Update',
  'admin.history.retimeInvalid':
    'Must be a valid ISO-8601 timestamp (e.g. 2026-05-29T12:00:00.000Z).',
  'admin.history.loadListsFailed': 'Failed to load lists: {reason}',
  'admin.history.loadFailed': 'Failed to load {name}: {reason}',
  'admin.history.saveFailed': 'Failed to save: {reason}',

  // ── Import Changes ────────────────────────────────────────────────────
  'admin.importChanges.desc':
    'Apply a change bundle exported from the site editor, covering one or more lists. Review the pending changes below, then apply them to your list files.',
  'admin.importChanges.applyFailed': 'Failed to apply changes',
  'admin.importChanges.applied': 'Changes applied',
  'admin.importChanges.appliedCount': {
    $plural: 'count',
    one: 'applied {count} change',
    other: 'applied {count} changes',
  },
  'admin.importChanges.skipped': 'Skipped (card not found): {change}',
  'admin.importChanges.sourceLabel': 'JSON source',
  'admin.importChanges.fileLabel': 'Change bundle (JSON)',
  'admin.importChanges.fileHint':
    "An export from the site editor's Export panel (single list or all lists)",
  'admin.importChanges.textLabel': 'Change JSON',
  'admin.importChanges.invalid': 'Invalid change bundle: {reason}',
  'admin.importChanges.pendingLabel': 'Pending changes — {changes} across {lists}',
  // The list type inflects the noun *and* the article in most languages, so it
  // selects a whole line rather than splicing a noun into one frame.
  'admin.importChanges.previewList': {
    $select: 'listType',
    deck: "{name} (deck '{slug}') — {changes}",
    collection: "{name} (collection '{slug}') — {changes}",
    wanted: "{name} (wanted list '{slug}') — {changes}",
    other: "{name} (list '{slug}') — {changes}",
  },
  'admin.importChanges.applying': 'Applying...',
  'admin.importChanges.applyButton': 'Apply {changes} to {lists}',

  // ── Import Deck ───────────────────────────────────────────────────────
  'admin.importDeck.methodLabel': 'Import method',
  'admin.importDeck.methodUrl': 'URL',
  'admin.importDeck.urlLabel': 'Deck URL',
  'admin.importDeck.urlHint': 'Supports Archidekt, Moxfield, and MTGGoldfish URLs',
  'admin.importDeck.fileLabel': 'Deck File',
  'admin.importDeck.fileHint': 'A decklist or exported deck file (markdown or plain text)',
  'admin.importDeck.textLabel': 'Decklist Text',
  'admin.importDeck.textHint':
    'One card per line as {syntax}. Use {heading} lines to start new sections.',
  'admin.importDeck.qtyName': 'QTY Name',
  'admin.importDeck.headingSyntax': '## Heading',
  'admin.importDeck.nameLabel': 'Deck Name',
  'admin.importDeck.namePlaceholder': 'Imported Deck',
  'admin.importDeck.nameHint': 'Used unless the text defines its own name.',
  'admin.importDeck.syncPrintings':
    'Import the exact printings (set, collector number, and foil/etched finish) the source lists',
  'admin.importDeck.overwrite': 'Overwrite existing deck if it exists',
  'admin.importDeck.import': 'Import Deck',
  'admin.importDeck.failed': 'Failed to import deck',

  // ── Import CSV ────────────────────────────────────────────────────────
  'admin.importCsv.sourceLabel': 'CSV source',
  'admin.importCsv.fileLabel': 'CSV File',
  'admin.importCsv.fileHint': 'A CSV export from Moxfield, Deckbox, ManaBox, or similar',
  'admin.importCsv.textLabel': 'CSV Text',
  'admin.importCsv.parseFailed': 'Failed to parse CSV: {reason}',
  'admin.importCsv.failuresLead': {
    $plural: 'count',
    one: '{count} row could not be imported:',
    other: '{count} rows could not be imported:',
  },
  'admin.importCsv.failureRow': 'Line {line}: {raw} — {reason}',
  'admin.importCsv.hasHeader': 'First row contains column headers',
  'admin.importCsv.mappingLabel': 'Column Mapping',
  'admin.importCsv.optional': '(optional)',
  'admin.importCsv.notInFile': '(not in this file)',
  'admin.importCsv.selectColumn': 'Select a column...',
  'admin.importCsv.chooseNameColumn': 'Choose which column holds the card name',
  'admin.importCsv.rowsHint': {
    $plural: 'count',
    one: '{count} data row detected. Conditions, finishes, and sections are normalized on import (e.g. “Near Mint” → NM, “F” → foil, “side” → Sideboard).',
    other:
      '{count} data rows detected. Conditions, finishes, and sections are normalized on import (e.g. “Near Mint” → NM, “F” → foil, “side” → Sideboard).',
  },
  'admin.importCsv.column': 'Column {index}',
  'admin.importCsv.columnWithHeader': 'Column {index}: {header}',
  'admin.importCsv.columnSample': '{label} (e.g. {sample})',
  'admin.importCsv.importIntoLabel': 'Import Into',
  'admin.importCsv.modeLabel': 'Import mode',
  'admin.importCsv.modeCreate': 'Create New List',
  'admin.importCsv.modeAppend': 'Append to Existing',
  'admin.importCsv.nameLabel': 'Name',
  'admin.importCsv.namePlaceholder': 'My Binder',
  'admin.importCsv.formatLabel': 'Format',
  'admin.importCsv.overwrite': 'Overwrite if a list with this name exists',
  'admin.importCsv.targetLabel': 'Target List',
  'admin.importCsv.selectList': 'Select a list...',
  'admin.importCsv.noLists': {
    $select: 'listType',
    deck: 'No decks exist yet — create one instead.',
    collection: 'No collections exist yet — create one instead.',
    wanted: 'No wanted lists exist yet — create one instead.',
    other: 'No lists exist yet — create one instead.',
  },
  'admin.importCsv.appendCards': 'Append Cards',
  'admin.importCsv.import': 'Import CSV',
  'admin.importCsv.failed': 'Failed to import CSV',

  // ── Manage Lists ──────────────────────────────────────────────────────
  //
  // A verb + capitalized noun concatenation does not survive case or gender, so
  // the list type selects a whole sentence rather than a spliced-in noun.
  'admin.list.createTitle': {
    $select: 'listType',
    deck: 'Create New Deck',
    collection: 'Create New Collection',
    wanted: 'Create New Wanted List',
    other: 'Create New List',
  },
  'admin.list.newButton': {
    $select: 'listType',
    deck: '+ New Deck',
    collection: '+ New Collection',
    wanted: '+ New Wanted List',
    other: '+ New List',
  },
  'admin.list.nameLabel': {
    $select: 'listType',
    deck: 'Deck Name',
    collection: 'Collection Name',
    wanted: 'Wanted List Name',
    other: 'List Name',
  },
  'admin.list.createButton': {
    $select: 'listType',
    deck: 'Create Deck',
    collection: 'Create Collection',
    wanted: 'Create Wanted List',
    other: 'Create List',
  },
  'admin.list.renameTitle': {
    $select: 'listType',
    deck: 'Rename Deck',
    collection: 'Rename Collection',
    wanted: 'Rename Wanted List',
    other: 'Rename List',
  },
  'admin.list.deleteTitle': {
    $select: 'listType',
    deck: 'Delete Deck',
    collection: 'Delete Collection',
    wanted: 'Delete Wanted List',
    other: 'Delete List',
  },
  'admin.list.deleteButton': {
    $select: 'listType',
    deck: 'Delete Deck',
    collection: 'Delete Collection',
    wanted: 'Delete Wanted List',
    other: 'Delete List',
  },
  'admin.list.namePlaceholder': {
    $select: 'listType',
    deck: 'e.g. My Commander Deck',
    collection: 'e.g. Main Collection',
    wanted: 'e.g. Holiday Wishlist',
    other: 'e.g. My List',
  },
  'admin.list.visibilityTitle': {
    $select: 'listType',
    deck: 'Show or hide this deck on the public site',
    collection: 'Show or hide this collection on the public site',
    wanted: 'Show or hide this wanted list on the public site',
    other: 'Show or hide this list on the public site',
  },
  'admin.list.loadFailed': {
    $select: 'listType',
    deck: 'Failed to load decks',
    collection: 'Failed to load collections',
    wanted: 'Failed to load wanted lists',
    other: 'Failed to load lists',
  },
  'admin.list.createFailed': {
    $select: 'listType',
    deck: 'Failed to create deck',
    collection: 'Failed to create collection',
    wanted: 'Failed to create wanted list',
    other: 'Failed to create list',
  },
  'admin.list.renameFailed': {
    $select: 'listType',
    deck: 'Failed to rename deck',
    collection: 'Failed to rename collection',
    wanted: 'Failed to rename wanted list',
    other: 'Failed to rename list',
  },
  'admin.list.deleteFailed': {
    $select: 'listType',
    deck: 'Failed to delete deck',
    collection: 'Failed to delete collection',
    wanted: 'Failed to delete wanted list',
    other: 'Failed to delete list',
  },
  'admin.list.visibilityFailed': {
    $select: 'listType',
    deck: 'Failed to update deck visibility',
    collection: 'Failed to update collection visibility',
    wanted: 'Failed to update wanted list visibility',
    other: 'Failed to update list visibility',
  },
  'admin.list.empty': {
    $select: 'listType',
    deck: 'No decks found.',
    collection: 'No collections found.',
    wanted: 'No wanted lists found.',
    other: 'No lists found.',
  },
  'admin.list.deleteWarning': {
    $select: 'listType',
    deck: 'This will permanently delete {name} and its changelog and primer. This cannot be undone.',
    collection: 'This will permanently delete {name} and its changelog. This cannot be undone.',
    wanted: 'This will permanently delete {name} and its changelog. This cannot be undone.',
    other: 'This will permanently delete {name} and its changelog. This cannot be undone.',
  },
  'admin.list.nowHidden': "'{name}' is now hidden from the public site",
  'admin.list.nowVisible': "'{name}' is now visible on the public site",
  'admin.list.unusableName': 'This name has no characters that can be used in a file name.',
  'admin.list.fileNameHint': 'File name: {file}',
  'admin.list.newFileNameHint': 'New file name: {file}',
  'admin.list.formatLabel': 'Format',
  'admin.list.creating': 'Creating...',
  'admin.list.renaming': 'Renaming...',
  'admin.list.deleting': 'Deleting...',
  'admin.list.rename': 'Rename',
  'admin.list.edit': 'Edit',
  'admin.list.delete': 'Delete',
  'admin.list.public': 'Public',
  'admin.list.hidden': 'Hidden',
  'admin.list.newNameLabel': 'New Name',
  'admin.list.renamingWhich': 'Renaming: {name}',
  'admin.list.deleteConfirmLabel': 'Type {name} to confirm',

  // ── Move Cards ────────────────────────────────────────────────────────
  'admin.moveCards.selectorLabel': 'Browse list',
  'admin.moveCards.searchLabel': 'Search cards',
  'admin.moveCards.searchPlaceholder': 'Type a card name to search every list…',
  'admin.moveCards.filters': 'Filters',
  'admin.moveCards.pending': 'Pending',
  'admin.moveCards.saving': 'Saving...',
  'admin.moveCards.save': 'Save Moves',
  'admin.moveCards.discard': 'Discard',
  'admin.moveCards.loadingLists': 'Loading lists…',
  'admin.moveCards.empty': 'Choose a list to browse, or search for a card to move.',
  'admin.moveCards.loadingList': 'Loading {name}…',
  'admin.moveCards.quantityTitle': 'Move cards',
  'admin.moveCards.quantityMessage':
    'How many of the {total} copies of {name} do you want to move?',
  'admin.moveCards.quantityMessageTo':
    'How many of the {total} copies of {name} do you want to move to {dest}?',
  'admin.moveCards.moveConfirm': 'Move',
  'admin.moveCards.leaveTitle': 'Discard queued moves?',
  'admin.moveCards.leaveConfirm': 'Discard',
  'admin.moveMenu.label': 'Move {name} to',
  'admin.moveMenu.empty': 'No eligible destinations',
  'admin.moveFilters.help':
    'Choose which lists you can move cards {from} (browsed and searched) and {to} (offered as destinations).',
  'admin.moveFilters.fromWord': 'from',
  'admin.moveFilters.toWord': 'to',
  'admin.moveFilters.fromLabel': 'From:',
  'admin.moveFilters.toLabel': 'To:',
  'admin.moveFilters.all': 'All',
  'admin.moveFilters.none': 'None',
  'admin.moveFilters.colList': 'List',
  'admin.moveFilters.colFrom': 'From',
  'admin.moveFilters.colTo': 'To',
  'admin.moveFilters.moveFrom': 'Move from {name}',
  'admin.moveFilters.moveTo': 'Move to {name}',
  'admin.moveFilters.noLists': 'No lists found.',
  'admin.movePending.title': 'Pending moves ({count})',
  'admin.movePending.empty': 'No moves queued yet.',
  'admin.movePending.discard': 'Discard',
  'admin.movePending.discardOne': 'Discard move of {name}',
  'admin.movePending.discardAll': 'Discard all',
  'admin.moveSearch.empty': 'No cards match “{query}” in the enabled source lists.',
  'admin.moveSearch.moveLabel': 'Move {name} to another list',
  'admin.move.nothingToMove': 'No cards to move.',
  'admin.move.loadListsFailed': 'Failed to load lists: {reason}',
  'admin.move.loadListFailed': 'Failed to load {name}',
  'admin.move.loadListFailedReason': 'Failed to load {name}: {reason}',
  // Deliberately opens with a space: it is appended to `admin.api.move.moved`.
  'admin.move.skippedSuffix': ' ({count} skipped)',
  'admin.move.saveFailed': 'Failed to save moves: {reason}',
  'admin.move.unsavedWarning': {
    $plural: 'count',
    one: '{count} queued move has not been saved, and will be lost.',
    other: '{count} queued moves have not been saved, and will be lost.',
  },
  'admin.api.move.moved': {
    $plural: 'count',
    one: 'Moved {count} card.',
    other: 'Moved {count} cards.',
  },
  'admin.move.matches': {
    $plural: 'count',
    one: '{count} match',
    other: '{count} matches',
  },

  // ── Sync pages (decks and collection) ─────────────────────────────────
  //
  // The run button used to be assembled as `${verb} ${count} decks`, splicing an
  // English verb into a counted noun phrase — which no inflected language
  // survives. Each verb gets its own message instead. A plural cannot nest
  // inside a `$select`, so the counted forms are one key per verb while the
  // uncounted "all" forms can share a single select.
  'admin.sync.previewDecks': {
    $plural: 'count',
    one: 'Preview {count} deck',
    other: 'Preview {count} decks',
  },
  'admin.sync.pullDecks': {
    $plural: 'count',
    one: 'Pull {count} deck',
    other: 'Pull {count} decks',
  },
  'admin.sync.pushDecks': {
    $plural: 'count',
    one: 'Push {count} deck',
    other: 'Push {count} decks',
  },
  'admin.sync.allDecksAction': {
    $select: 'action',
    preview: 'Preview all decks',
    pull: 'Pull all decks',
    push: 'Push all decks',
    other: 'Sync all decks',
  },
  'admin.sync.previewLists': {
    $plural: 'count',
    one: 'Preview {count} list',
    other: 'Preview {count} lists',
  },
  'admin.sync.pullLists': {
    $plural: 'count',
    one: 'Pull {count} list',
    other: 'Pull {count} lists',
  },
  'admin.sync.pushLists': {
    $plural: 'count',
    one: 'Push {count} list',
    other: 'Push {count} lists',
  },
  'admin.sync.wholeCollectionAction': {
    $select: 'action',
    preview: 'Preview whole collection',
    pull: 'Pull whole collection',
    push: 'Push whole collection',
    other: 'Sync whole collection',
  },

  // ── Shared sync chrome ────────────────────────────────────────────────
  'admin.sync.lastSyncedLabel': 'Last synced:',
  'admin.sync.lastSyncedAgo': '{duration} ago',
  'admin.sync.neverSynced': 'never synced',
  'admin.sync.progress': 'Progress',
  'admin.sync.syncing': 'Syncing…',
  'admin.sync.connectionDropped':
    'The connection dropped mid-sync. Reload to see how far the run got.',
  'admin.sync.complete': 'Sync complete.',
  'admin.sync.directionHeading': 'Direction',
  'admin.sync.directionLabel': 'Sync direction',
  'admin.sync.pull': 'Pull',
  'admin.sync.push': 'Push',
  'admin.sync.filterHeading': 'Changes',
  'admin.sync.filterLabel': 'Changes to apply',
  'admin.sync.filterAll': 'All changes',
  'admin.sync.filterAllDesc':
    'Apply every difference: cards added, cards removed, and quantity changes.',
  'admin.sync.filterAdditions': 'Additions only',
  'admin.sync.filterAdditionsDesc':
    'Only add cards. New cards and quantity increases are applied to the destination (your list files on a pull, Archidekt on a push); removals and decreases are reported but skipped.',
  'admin.sync.filterRemovals': 'Removals only',
  'admin.sync.filterRemovalsDesc':
    'Only take cards away. Removals and quantity decreases are applied to the destination; new cards and increases are reported but skipped.',
  'admin.sync.unreadableDecks': {
    $plural: 'count',
    one: '{count} deck contains lines Ritual cannot read.',
    other: '{count} decks contain lines Ritual cannot read.',
  },
  'admin.sync.unreadableLists': {
    $plural: 'count',
    one: '{count} collection list contains lines Ritual cannot read.',
    other: '{count} collection lists contain lines Ritual cannot read.',
  },
  'admin.sync.ambiguousLead': {
    $plural: 'count',
    one: "{count} removal could not be placed, so {emphasis}. Set a removal priority above and run again, or keep a printing's copies in one list.",
    other:
      "{count} removals could not be placed, so {emphasis}. Set a removal priority above and run again, or keep a printing's copies in one list.",
  },
  'admin.sync.nothingWritten': 'nothing was written',

  // ── Sync CSV outcome ──────────────────────────────────────────────────
  'admin.syncCsv.uploaded': {
    $plural: 'count',
    one: 'Uploaded {size} to Archidekt as a CSV import in {count} request.',
    other: 'Uploaded {size} to Archidekt as a CSV import in {count} requests.',
  },
  'admin.syncCsv.uncachedPlanned': {
    $plural: 'count',
    one: '{count} new card could not ride the CSV (the printing is not in your Scryfall cache), so it would be added one at a time instead.',
    other:
      '{count} new cards could not ride the CSV (the printing is not in your Scryfall cache), so they would be added one at a time instead.',
  },
  'admin.syncCsv.uncachedApplied': {
    $plural: 'count',
    one: '{count} new card could not ride the CSV (the printing is not in your Scryfall cache), so it was added one at a time instead.',
    other:
      '{count} new cards could not ride the CSV (the printing is not in your Scryfall cache), so they were added one at a time instead.',
  },

  // ── Sync Decks page ───────────────────────────────────────────────────
  'admin.deckSync.desc':
    'Sync decks imported from Archidekt. Decks are matched by card name and quantity; a pull also adopts the deck’s Archidekt format.',
  'admin.deckSync.loading': 'Loading Archidekt decks…',
  'admin.deckSync.loadFailed': 'Could not load Archidekt decks.',
  'admin.deckSync.none':
    'No Archidekt decks found. Import a deck from an Archidekt URL to sync it.',
  'admin.deckSync.neverAny': 'never — no deck has synced yet',
  'admin.deckSync.pullDesc':
    'Archidekt → local. Applies remote card and format changes to your deck files and records them in each deck’s changelog.',
  'admin.deckSync.pushDesc':
    'Local → Archidekt. Sends your card additions, removals, and quantity changes to decks you own on Archidekt.',
  'admin.deckSync.decksHeading': 'Decks',
  'admin.deckSync.allDecks': 'All decks',
  'admin.deckSync.selectedCount': '{count} of {total} selected',
  'admin.deckSync.syncPrintings':
    "Also sync each card's exact printing (set, collector number, and foil/etched finish)",
  'admin.deckSync.dryRun':
    'Preview only — report what would change without writing files or pushing',
  'admin.deckSync.signInPrompt': 'Sign in to Archidekt above to sync.',
  'admin.deckSync.confirmUnreadable': 'Sync anyway and remove those lines',
  'admin.deckSync.failed': 'Failed to sync decks.',

  // ── Sync Collection page ──────────────────────────────────────────────
  'admin.collectionSync.desc':
    'Sync your collection lists with the Archidekt collection of the signed-in account. Copies are matched by printing, finish, and condition; an account has one collection, so every list in scope is compared against it at once.',
  'admin.collectionSync.loading': 'Loading collection lists…',
  'admin.collectionSync.loadFailed': 'Could not load collection lists.',
  'admin.collectionSync.neverAny': 'never — this account has not synced yet',
  'admin.collectionSync.pullDesc':
    'Archidekt → local. Adds copies your lists are missing to the target list below, and removes copies Archidekt no longer has. Removing only some of a printing’s copies when they are spread across several lists needs the removal priority below — which one lost it is otherwise unknowable, and a real run stops without writing anything.',
  'admin.collectionSync.pushDesc':
    'Local → Archidekt. Creates, grows, trims, and deletes records in your Archidekt collection until it matches the lists in scope. Nothing is written locally.',
  'admin.collectionSync.scopeHeading': 'Scope',
  'admin.collectionSync.scopeLabel': 'Collection lists to sync',
  'admin.collectionSync.scopeAll': 'Whole collection',
  'admin.collectionSync.scopeAllDesc':
    'Compare every collection list against your Archidekt collection, including lists created since this page loaded.',
  'admin.collectionSync.scopeLists': 'Selected lists',
  'admin.collectionSync.scopeListsDesc':
    'Compare only the lists you pick. The remote side is still your whole Archidekt collection, so cards that live only in the lists you left out read as missing — pair this with a change filter when the selection is not the whole story.',
  'admin.collectionSync.noLists': 'No collection lists yet — there is nothing to pick.',
  'admin.collectionSync.intoHeading': 'Add new cards to',
  'admin.collectionSync.intoDesc':
    'A card that appeared on Archidekt belongs in {emphasis} list and only you know which, so every addition lands in this one. It defaults to the {setting} setting, and is created if it does not exist yet.',
  'admin.collectionSync.intoDescEmphasis': 'some',
  'admin.collectionSync.intoSetting': 'collectionSync.pullTarget',
  'admin.collectionSync.intoLabel': 'List a pull adds new cards to',
  'admin.collectionSync.willBeCreated': '{name} (will be created)',
  'admin.collectionSync.dryRun':
    'Preview only — report what would change without writing files or touching Archidekt',
  'admin.collectionSync.signInPrompt':
    'Sign in to Archidekt above to sync, or manage the stored session on the {link} page.',
  'admin.collectionSync.confirmUnreadable': 'Sync anyway and lose those lines',
  'admin.collectionSync.failed': 'Failed to sync the collection.',
  'admin.collectionSync.resultMeta': '+{added} added, -{removed} removed',

  // ── Removal priority (Sync Collection) ────────────────────────────────
  'admin.priority.heading': 'Removal priority',
  'admin.priority.desc':
    'When a printing loses copies remotely but its local copies live in several lists, nothing says which one the card left. Name the lists that may give copies up, in order — the first is asked first, and only these lists are touched.',
  'admin.priority.descRun': 'Without one, a run that meets such a removal {emphasis}.',
  'admin.priority.descPreview':
    'A preview reports such a removal instead of failing; a real run without a priority {emphasis}.',
  'admin.priority.failsAndWritesNothing': 'fails and writes nothing',
  'admin.priority.emptyPreview':
    'No priority set — a preview will report an ambiguous removal instead of placing it.',
  'admin.priority.emptyRun':
    'No priority set — an ambiguous removal will stop the run before anything is written.',
  'admin.priority.remove': 'Remove {name} from the removal priority',
  'admin.priority.noLists': 'No collection lists in scope — there is nothing to prioritize.',

  // ── CSV upload toggle and outcome (Sync Collection) ───────────────────
  'admin.csvToggle.heading': 'New cards',
  'admin.csvToggle.desc':
    'A printing your Archidekt collection does not have yet costs a search plus a create, paced half a second apart, so a first push of a real collection would take hundreds of requests. Uploaded as one CSV import it takes one, with every row built from your local Scryfall cache. Quantity changes and removals never ride it.',
  'admin.csvToggle.label': 'Upload new cards as one CSV import',
  'admin.csvToggle.thresholdFew': 'a few',
  'admin.csvToggle.offRun':
    'Off: new cards are added one at a time, and a push with more than {threshold} of them {emphasis} — a browser cannot be asked half way through a run, so this toggle is that answer.',
  'admin.csvToggle.offPreview':
    'Off: new cards would be added one at a time — though a preview still reports the upload it would make. A {real} push with more than {threshold} of them {emphasis}.',
  'admin.csvToggle.offPreviewReal': 'real',
  'admin.csvToggle.failsWithoutPushing': 'fails without pushing anything at all',
  'admin.csvOutcome.unconfirmed': {
    $plural: 'count',
    one: "Archidekt's answer to {count} of them could not be read, so those rows are counted as imported without confirmation — the run log has what it said.",
    other:
      "Archidekt's answer to {count} of them could not be read, so those rows are counted as imported without confirmation — the run log has what it said.",
  },
  'admin.csvOutcome.exported':
    'Wrote {size} to {path} instead of pushing them — those cards reach Archidekt only once that file is imported by hand.',
  'admin.csvOutcome.plannedUpload':
    'Would upload {size} to Archidekt as one CSV import — nothing was searched or sent.',
  'admin.csvOutcome.plannedExport': 'Would write {size} to {path} instead of pushing them.',
  'admin.csvOutcome.failed':
    'The CSV import failed: {message} Those cards were not added; the rest of the run applied.',
  'admin.csvOutcome.empty':
    'No CSV was built: not one of the {count} new cards has a printing in your Scryfall cache, so no row could be keyed by a Scryfall ID. Refresh the cache ({command}) and run again.',
  'admin.csvOutcome.emptyCommand': 'ritual cache preload-all',
  'admin.csvOutcome.failuresLead':
    'Archidekt did not import {dropped} of {total} rows{reasons}. The lists holding those cards are reported as failed.',
  'admin.csvOutcome.failure': '{card} — {reason}',

  // ── Settings ──────────────────────────────────────────────────────────
  'admin.settings.save': 'Save Settings',
  'admin.settings.saved': 'Settings saved',
  'admin.settings.loading': 'Loading settings...',
  'admin.settings.loadFailed': 'Failed to load config',
  'admin.settings.saveFailed': 'Failed to save settings',
  'admin.settings.saving': 'Saving...',
  'admin.settings.decksDir': 'Decks Directory',
  'admin.settings.decksDirPlaceholder': 'e.g. ./decks',
  'admin.settings.collectionsDir': 'Collections Directory',
  'admin.settings.collectionsDirPlaceholder': 'e.g. ./collections',
  'admin.settings.wantedDir': 'Wanted List Directory',
  'admin.settings.wantedDirPlaceholder': 'e.g. ./wanted',
  'admin.settings.defaultCurrency': 'Default Price Currency',
  'admin.settings.currencyUsd': 'USD (TCGplayer)',
  'admin.settings.currencyEur': 'EUR (Cardmarket)',
  'admin.settings.currencyTix': 'TIX (MTGO)',
  'admin.settings.defaultLanguage': 'Default Language',
  'admin.settings.languageOption': '{name} ({code})',
  'admin.settings.defaultLanguageHint':
    'The language stamped on newly added cards. Non-English defaults use the larger all-languages Scryfall bulk for the card cache. A card line without a language token always means English, regardless of this setting.',
  'admin.settings.uiLocale': 'Interface Language',
  'admin.settings.uiLocaleHint':
    'The language Ritual’s own interface speaks. This is not Default Language above, which picks which printing of a card is shown — a Japanese interface listing English printings is a valid combination.',
  'admin.settings.uiLocaleOption': '{endonym} ({tag})',
  'admin.settings.cacheSource': 'Cache Source',
  'admin.settings.cacheSourceScryfall': 'Scryfall (direct bulk download)',
  'admin.settings.cacheSourceFeed': 'Cache feed (peer-to-peer)',
  'admin.settings.cacheFeedUrl': 'Cache Feed URL',
  'admin.settings.cacheFeedUrlPlaceholder':
    'https://feed.example.com/feed.json (uses the built-in default when empty)',
  'admin.settings.cacheLockTimeout': 'Cache Lock Timeout (seconds)',
  'admin.settings.cacheLockTimeoutPlaceholder': 'e.g. 300',
  'admin.settings.searchDebounce': 'Card Search Debounce (ms)',
  'admin.settings.searchDebouncePlaceholder': 'e.g. 500',
  'admin.settings.searchDebounceHint':
    "How long the editors' add-card search waits after a keystroke before querying autocomplete. 0 disables the debounce. Applies to the public site the next time it is built.",
  'admin.settings.gitHeading': 'Git Integration',
  'admin.settings.gitEnabled': 'Enable Git integration',
  'admin.settings.gitAutoCommit': 'Auto-commit changes',
  'admin.settings.gitAutoPush': 'Auto-push after commit',
  'admin.settings.gitHint':
    'When enabled, file changes from admin actions will be automatically committed to git and pushed to the remote.',
  'admin.settings.networkHeading': 'Network Security',
  'admin.settings.trustProxy': 'Trust reverse proxy headers',
  'admin.settings.trustProxyHint':
    'Enable if running behind a reverse proxy (nginx, Caddy, etc.). Only parses X-Forwarded-For when enabled. Leave off for direct connections.',
  'admin.settings.secureCookies': 'Secure cookies (HTTPS only)',
  'admin.settings.secureCookiesHint':
    'Set the Secure flag on session cookies so they are only sent over HTTPS. Enable when using TLS or a TLS-terminating reverse proxy.',
  'admin.settings.totpHeading': 'Two-Factor Authentication (TOTP)',
  'admin.settings.rateLimitHeading': 'Rate Limiting',
  'admin.settings.rateLimitEnabled': 'Enable rate limiting',
  'admin.settings.rateLimitMax': 'Max failed attempts',
  'admin.settings.rateLimitWindow': 'Lockout (minutes)',
  'admin.settings.failedAuthDelay': 'Failed auth delay (ms)',
  'admin.settings.failedAuthDelayHint':
    'Delay before responding to invalid login attempts (helps prevent brute force).',
  'admin.settings.ipHeading': 'IP Filtering',
  'admin.settings.ipHint':
    'One entry per line. Supports wildcards (*). Leave empty to allow all. If allow list is set, only listed IPs can connect.',
  'admin.settings.ipAllow': 'IP Allow List',
  'admin.settings.ipAllowPlaceholder': 'e.g. 192.168.1.*',
  'admin.settings.ipDeny': 'IP Deny List',
  'admin.settings.ipDenyPlaceholder': 'e.g. 10.0.0.5',
  'admin.settings.uaHeading': 'User-Agent Filtering',
  'admin.settings.uaHint': 'One entry per line. Supports wildcards (*). Leave empty to allow all.',
  'admin.settings.uaAllow': 'User-Agent Allow List',
  'admin.settings.uaAllowPlaceholder': 'e.g. Mozilla*',
  'admin.settings.uaDeny': 'User-Agent Deny List',
  'admin.settings.uaDenyPlaceholder': 'e.g. *bot*',
  'admin.settings.publicSiteHeading': 'Public Site',
  'admin.settings.publishHint':
    'Controls which lists are published when building the public site. Enter {all} to include every list in that category (the default), or list display names (one per line) to publish only those. Leave empty to publish none.',
  'admin.settings.includeDecks': 'Decks to publish',
  'admin.settings.includeCollections': 'Collections to publish',
  'admin.settings.includeWanted': 'Wanted lists to publish',
  'admin.settings.excludeHint':
    'Exclude specific lists by display name (one per line), even when the publish list above includes them. The visibility toggles on the Manage Lists page edit these. Leave empty to exclude nothing.',
  'admin.settings.excludeDecks': 'Decks to exclude',
  'admin.settings.excludeCollections': 'Collections to exclude',
  'admin.settings.excludeWanted': 'Wanted lists to exclude',
  'admin.settings.apiBaseUrlHint':
    'Optional live backend for a split deployment: a statically deployed site fetches live list data and cache-backed card search from a separately hosted {command} instance at this URL (baked in by the next site build). Leave empty for a fully static site.',
  'admin.settings.apiBaseUrlCommand': 'ritual serve --api',
  'admin.settings.apiBaseUrl': 'API base URL',
  'admin.settings.apiBaseUrlPlaceholder': 'https://ritual-api.example.com',
  'admin.settings.sellMode': 'Offer sell mode',
  'admin.settings.sellModeHint':
    'Show Card Kingdom buy prices, the buylist filters and groupings, and the sell-cart export — both on the published site and in this admin’s editors, Move Cards panes and Refresh Cache page. Off by default: turning it on makes every site build and cache refresh download and index Card Kingdom’s ~70 MB buylist. Saving applies immediately, with no reload or restart; a server started with {flag} offers sell mode whatever this is set to.',
  'admin.settings.sellModeFlag': '--sell-mode',
  'admin.settings.printingsHeading': 'Default Printings',
  'admin.settings.printingsHint':
    "Printings that may never be auto-selected as a card's default (featured) printing, one per line as {format} (e.g. {example}). When a banned printing would be chosen, the next eligible printing is featured instead. Banned printings can still be viewed and entered manually.",
  'admin.settings.printingsFormat': 'SET:COLLECTOR',
  'admin.settings.printingsExample': 'SLD:123',
  'admin.settings.bannedPrintings': 'Banned default printings',
  'admin.settings.bannedPrintingsPlaceholder': 'e.g. SLD:123',

  // ══ admin.api.* ══════════════════════════════════════════════════════
  //
  // Prose the admin API *authors*. Every one of these is rendered to English
  // at the handler (that is what `message` carries, unchanged, for MCP and
  // curl) and re-rendered in the reader's locale from `messageKey` +
  // `messageParams` by `useApiAction`. See plan §7.7.

  // ── List lifecycle ────────────────────────────────────────────────────
  //
  // Verb + noun concatenation does not survive case or gender, so the list
  // type selects a whole sentence rather than splicing a noun in.
  'admin.api.list.created': {
    $select: 'listType',
    deck: "Created deck '{name}'",
    collection: "Created collection '{name}'",
    wanted: "Created wanted list '{name}'",
    other: "Created list '{name}'",
  },
  'admin.api.list.renamed': {
    $select: 'listType',
    deck: "Renamed deck to '{name}'",
    collection: "Renamed collection to '{name}'",
    wanted: "Renamed wanted list to '{name}'",
    other: "Renamed list to '{name}'",
  },
  'admin.api.list.deleted': {
    $select: 'listType',
    deck: "Deleted deck '{name}'",
    collection: "Deleted collection '{name}'",
    wanted: "Deleted wanted list '{name}'",
    other: "Deleted list '{name}'",
  },

  // ── One-shot operations ───────────────────────────────────────────────
  'admin.api.save.saved': 'Saved {count} changes to {name}',
  'admin.api.buildSite.built': 'Site built successfully',
  'admin.api.cache.refreshed': 'Cache refreshed successfully',
  'admin.api.history.saved': {
    $plural: 'count',
    one: 'Saved {count} change set.',
    other: 'Saved {count} change sets.',
  },
  'admin.api.move.removed': {
    $plural: 'count',
    one: 'Removed {count} card.',
    other: 'Removed {count} cards.',
  },

  // ── Archidekt session ─────────────────────────────────────────────────
  'admin.api.archidekt.loggedIn': 'Logged in as {username}',
  'admin.api.archidekt.credentialsRequired': 'username and password are required',

  // ── Deck sync run summary ─────────────────────────────────────────────
  //
  // A run summary is assembled from clauses joined with `Intl.ListFormat` and
  // terminated by the renderer, so **no clause carries final punctuation** —
  // see `src/admin/api/sync-summary.ts`.
  'admin.api.deckSync.loginRequired':
    'Not signed into Archidekt. Sign in to sync decks with Archidekt.',
  'admin.api.deckSync.noDecks': 'No Archidekt decks found to sync',
  'admin.api.deckSync.previewed': {
    $plural: 'count',
    one: 'Previewed {count} deck',
    other: 'Previewed {count} decks',
  },
  'admin.api.deckSync.pulled': {
    $plural: 'count',
    one: 'Pulled {count} deck',
    other: 'Pulled {count} decks',
  },
  'admin.api.deckSync.pushed': {
    $plural: 'count',
    one: 'Pushed {count} deck',
    other: 'Pushed {count} decks',
  },
  'admin.api.deckSync.skipped': '{count} skipped',
  'admin.api.deckSync.failed': '{count} failed',

  // ── Collection sync run summary ───────────────────────────────────────
  'admin.api.collectionSync.loginRequired':
    'Not signed into Archidekt. Sign in to sync your collection with Archidekt.',
  'admin.api.collectionSync.accountRequired':
    'The stored Archidekt login does not name an account. Sign in to Archidekt again to record it.',
  'admin.api.collectionSync.noLists': 'No collection lists found to sync',
  'admin.api.collectionSync.totals': {
    $select: 'action',
    previewed: 'Previewed +{added} added, -{removed} removed',
    pulled: 'Pulled +{added} added, -{removed} removed',
    pushed: 'Pushed +{added} added, -{removed} removed',
    other: 'Synced +{added} added, -{removed} removed',
  },
  'admin.api.collectionSync.totalsInto': {
    $select: 'action',
    previewed: 'Previewed +{added} added, -{removed} removed into "{into}"',
    pulled: 'Pulled +{added} added, -{removed} removed into "{into}"',
    pushed: 'Pushed +{added} added, -{removed} removed into "{into}"',
    other: 'Synced +{added} added, -{removed} removed into "{into}"',
  },
  'admin.api.collectionSync.pending': '{count} awaiting a manual CSV upload',
  'admin.api.collectionSync.filtered': '{count} filtered out',
  'admin.api.collectionSync.ambiguous': {
    $plural: 'count',
    one: '{count} ambiguous removal',
    other: '{count} ambiguous removals',
  },
  'admin.api.collectionSync.listsFailed': {
    $plural: 'count',
    one: '{count} list failed',
    other: '{count} lists failed',
  },
  'admin.api.collectionSync.errors': {
    $plural: 'count',
    one: '{count} error',
    other: '{count} errors',
  },
} as const satisfies MessageCatalogShape
