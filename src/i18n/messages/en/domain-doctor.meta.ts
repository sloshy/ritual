/** Translator metadata for {@link domainDoctorMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { domainDoctorMessages } from './domain-doctor'

const DOCTOR =
  "`ritual doctor` checks a user's Ritual setup and prints one line per check, which the user may paste into a public bug report."

const SUMMARY = `${DOCTOR} This is one check's summary line: a sentence fragment with no closing period.`

const HINT = `${DOCTOR} This is the one-line fix shown under a check that found something to do: a full sentence with a closing period.`

const PATH = '{path} is a folder path, with the home folder shown as "~"; never translate it.'

const FILE = '{file} is the settings file name ritual.config.json; never translate it.'

const COMMAND =
  '{command} is a command line the user types; never translate it. Keep the backticks.'

const CACHE =
  'The card cache is the local copy of card data (names, printings, prices) Ritual downloads from Scryfall. {cards} is a count with its noun ("31,240 cards").'

const AGE = '{age} is a duration such as "3 hours" or "2 days".'

export const domainDoctorMeta = {
  'domain.doctor.ritual.summary': {
    description: `${SUMMARY} Which Ritual is running: {version} its version, {build} how it was built (domain.doctor.build.*), {install} how it runs (domain.doctor.install.*), {platform} and {arch} the operating system and processor names (for example "linux x64"), {bun} the version of Bun, the JavaScript runtime Ritual runs on. Never translate the versions or the platform names.`,
  },
  'domain.doctor.build.release': {
    description:
      'Shown as {build} in domain.doctor.ritual.summary: an official Ritual release, built by the project at a release tag.',
  },
  'domain.doctor.build.development': {
    description:
      'Shown as {build} in domain.doctor.ritual.summary: any build that is not an official release (a local build, a build between releases).',
  },
  'domain.doctor.install.binary': {
    description:
      'Shown as {install} in domain.doctor.ritual.summary: Ritual runs as a single downloaded program file.',
  },
  'domain.doctor.install.source': {
    description:
      'Shown as {install} in domain.doctor.ritual.summary: Ritual runs from a copy of its source code, through the Bun runtime.',
  },
  'domain.doctor.install.docker': {
    description:
      "Shown as {install} in domain.doctor.ritual.summary: Ritual runs inside the project's Docker container image.",
  },
  'domain.doctor.workspace.found': {
    description: `${SUMMARY} The workspace is the folder holding the user's decks, collections and wanted lists. ${PATH} {lists} counts the lists of each kind, joined with commas ("3 decks, 1 collection, 0 wanted lists").`,
  },
  'domain.doctor.workspace.notFound': {
    description: `${SUMMARY} The folder Ritual is looking at has none of the things a workspace holds, which usually means Ritual was run from the wrong folder. ${PATH} ${FILE}`,
  },
  'domain.doctor.workspace.notFoundHint': {
    description: `${HINT} {flag} is the command-line option "--base-dir <path>" that points Ritual at another folder; never translate it. ${COMMAND}`,
  },
  'domain.doctor.config.absent': {
    description: `${SUMMARY} The workspace has no settings file, which is normal. ${FILE}`,
  },
  'domain.doctor.config.valid': { description: `${SUMMARY} ${FILE}` },
  'domain.doctor.config.invalid': {
    description: `${SUMMARY} Some settings in the file have values Ritual does not accept. {count} is how many. ${FILE} The settings are listed on the lines below.`,
  },
  'domain.doctor.config.invalidHint': {
    description: `${HINT} Ritual runs with each refused setting's default value, except that it refuses to publish a website while the "site" settings block is invalid. ${FILE} {command} is "ritual config unset <key>", which removes one setting; never translate it, including "<key>".`,
  },
  'domain.doctor.config.unreadable': {
    description: `${SUMMARY} The settings file is not valid JSON (the reason is on the next line). ${FILE}`,
  },
  'domain.doctor.config.unreadableHint': { description: `${HINT} ${FILE}` },
  'domain.doctor.migrations.noConfig': {
    description: `${SUMMARY} "Workspace updates" are the changes \`ritual migrate\` makes to a workspace's files when a new Ritual version changes their format; a workspace with no settings file has none to check. ${FILE}`,
  },
  'domain.doctor.migrations.current': {
    description: `${SUMMARY} No workspace updates (see domain.doctor.migrations.noConfig) are waiting.`,
  },
  'domain.doctor.migrations.pending': {
    description: `${SUMMARY} Workspace updates (see domain.doctor.migrations.noConfig) are waiting to be applied.`,
  },
  'domain.doctor.migrations.pendingHint': {
    description: `${HINT} {preview} is "ritual migrate --dry-run" and {command} is "ritual migrate"; never translate either. Keep the backticks.`,
  },
  'domain.doctor.migrations.ahead': {
    description: `${SUMMARY} The workspace was updated by a newer Ritual version than the one running, which may not understand it.`,
  },
  'domain.doctor.migrations.aheadHint': { description: `${HINT} ${COMMAND}` },
  'domain.doctor.migrations.invalid': {
    description: `${SUMMARY} Applying the workspace updates would produce a settings file Ritual rejects; the setting at fault is on the next line.`,
  },
  'domain.doctor.migrations.invalidHint': { description: `${HINT} ${FILE}` },
  'domain.doctor.migrations.unknown': {
    description: `${SUMMARY} The check for workspace updates failed; the reason is on the next line.`,
  },
  'domain.doctor.migrations.noProbe': {
    description: `Shown under domain.doctor.migrations.unknown as the reason: the program reporting the diagnostics was started without the part that checks for workspace updates (normally never seen; it can happen in a test harness). A sentence fragment with no closing period.`,
  },
  'domain.doctor.migrations.blocked': {
    description: `${SUMMARY} The check for workspace updates was skipped because the settings file is broken or invalid, which the line above reports. ${FILE}`,
  },
  'domain.doctor.cache.server': {
    description: `${SUMMARY} ${CACHE} Here the card data is read from a separate Ritual cache server instead; {address} is its host and port. Never translate it.`,
  },
  'domain.doctor.cache.unreadable': {
    description: `${SUMMARY} ${CACHE} Reading it failed (a damaged or unreadable file); the reason is on the next line. ${PATH}`,
  },
  'domain.doctor.cache.empty': { description: `${SUMMARY} ${CACHE} ${PATH}` },
  'domain.doctor.cache.emptyHint': { description: `${HINT} ${COMMAND}` },
  'domain.doctor.cache.bulkStale': {
    description: `${SUMMARY} ${CACHE} ${PATH} The cache was downloaded for one card language setting and the setting has changed since. {configKey} is the setting name defaultLanguage; never translate it.`,
  },
  'domain.doctor.cache.refreshHint': { description: `${HINT} ${COMMAND}` },
  'domain.doctor.cache.neverRefreshed': {
    description: `${SUMMARY} ${CACHE} ${PATH} A "full refresh" downloads all card data and prices at once; this cache was filled card by card instead.`,
  },
  'domain.doctor.cache.stale': {
    description: `${SUMMARY} ${CACHE} ${PATH} ${AGE} Prices count as out of date after a day.`,
  },
  'domain.doctor.cache.fresh': { description: `${SUMMARY} ${CACHE} ${PATH} ${AGE}` },
  'domain.doctor.update.development': {
    description: `${SUMMARY} Ritual checks for new releases only in official release builds.`,
  },
  'domain.doctor.update.docker': {
    description: `${SUMMARY} In the Docker image, Ritual is updated by downloading the new image rather than by itself. ${COMMAND}`,
  },
  'domain.doctor.update.off': {
    description: `${SUMMARY} The user turned off the daily check for new Ritual releases. {configKey} is the setting name updateCheck and {envVar} the environment variable RITUAL_NO_UPDATE_CHECK; never translate either.`,
  },
  'domain.doctor.update.available': {
    description: `${SUMMARY} A newer Ritual release exists. {latest} is its version and {current} the running version; never translate them.`,
  },
  'domain.doctor.update.availableHint': { description: `${HINT} ${COMMAND}` },
  'domain.doctor.update.neverChecked': {
    description: `${SUMMARY} Ritual has not yet looked up whether a newer release exists.`,
  },
  'domain.doctor.update.current': {
    description: `${SUMMARY} The last lookup found no newer Ritual release. ${AGE}`,
  },
} as const satisfies MetaFor<typeof domainDoctorMessages>
