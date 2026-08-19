/**
 * The move session's list-toggle screens, shared by the Session Filters dialog
 * and by Batch Mode's "which lists am I looking at" step. Both edit a
 * `Set<filePath>` in place through the same two-level (category → list) screen,
 * so the two never drift into different toggle idioms.
 */

import prompts, { type Choice } from 'prompts'
import type { ListEntry } from './move-helpers'
import { getToggleState, toggleItemTitle, toggleSetAll, toggleStateChar } from './move-helpers'
import { LIST_TYPES, listTypeTitle, type ListType } from '../list-type'
import type { EnglishCatalog, MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'

/** The session's lists, bucketed by list type for the toggle menus. */
type ListsByType = Record<ListType, ListEntry[]>

/**
 * Which screen a toggle view is serving: a move side, or Batch Mode's sources.
 * Read off the message's own `$select` branches, so a fourth direction cannot
 * be added without giving it a heading — `t()` checks the parameter's name, not
 * its value, and an unbranched value renders as the raw key.
 */
export type ToggleDirection = Exclude<keyof EnglishCatalog['cli.move.toggleListsPrompt'], '$select'>

/** The category row each list type is summarized by. */
const GROUP_LABEL = {
  deck: 'cli.move.toggleGroupDecks',
  collection: 'cli.move.toggleGroupCollections',
  wanted: 'cli.move.toggleGroupWanted',
} as const satisfies Record<ListType, MessageKey>

/** The sentinel a category row carries, which names the sub-screen it opens. */
type TypeSentinel = `type:${ListType}`

export async function promptListToggle(
  enabledSet: Set<string>,
  allLists: ListEntry[],
  direction: ToggleDirection,
  requireAtLeastOne: boolean,
): Promise<void> {
  const byType: ListsByType = {
    deck: allLists.filter((l) => l.ref.type === 'deck'),
    collection: allLists.filter((l) => l.ref.type === 'collection'),
    wanted: allLists.filter((l) => l.ref.type === 'wanted'),
  }

  while (true) {
    const choices: Choice[] = []

    for (const type of LIST_TYPES) {
      const lists = byType[type]
      if (lists.length === 0) continue
      const paths = lists.map((l) => l.filePath)
      choices.push({
        title: t(GROUP_LABEL[type], {
          state: toggleStateChar(getToggleState(paths, enabledSet)),
          enabled: paths.filter((p) => enabledSet.has(p)).length,
          total: paths.length,
        }),
        value: `type:${type}` satisfies TypeSentinel,
      })
    }

    choices.push(
      { title: t('cli.move.toggleAllOn'), value: '__ALL_ON__' },
      { title: t('cli.move.toggleAllOff'), value: '__ALL_OFF__' },
      { title: t('cli.move.done'), value: '__BACK__' },
    )

    const response = (await prompts({
      type: 'select',
      name: 'action',
      message: t('cli.move.toggleListsPrompt', { direction }),
      choices,
    })) as ToggleResponse

    const action = response.action
    if (action === undefined || action === '__BACK__') break

    if (action === '__ALL_ON__') {
      toggleSetAll(
        enabledSet,
        allLists.map((l) => l.filePath),
        true,
      )
      continue
    }

    if (action === '__ALL_OFF__') {
      if (requireAtLeastOne) {
        console.log(t('cli.move.keepOneDestination'))
        continue
      }
      toggleSetAll(
        enabledSet,
        allLists.map((l) => l.filePath),
        false,
      )
      continue
    }

    const type = LIST_TYPES.find((candidate) => action === `type:${candidate}`)
    if (type !== undefined) {
      await promptSubListToggle(enabledSet, byType[type], type, requireAtLeastOne, allLists)
    }
  }
}

/** Both toggle screens resolve to a sentinel, a `type:` row, or a list's file path. */
type ToggleResponse = { action?: string }

async function promptSubListToggle(
  enabledSet: Set<string>,
  lists: ListEntry[],
  category: ListType,
  requireAtLeastOne: boolean,
  allLists: ListEntry[],
): Promise<void> {
  while (true) {
    const choices: Choice[] = lists.map((l) => ({
      title: toggleItemTitle(enabledSet.has(l.filePath), l.ref.name),
      value: l.filePath,
    }))

    choices.push(
      { title: t('cli.move.toggleAllOn'), value: '__ALL_ON__' },
      { title: t('cli.move.toggleAllOff'), value: '__ALL_OFF__' },
      { title: t('cli.move.back'), value: '__BACK__' },
    )

    const response = (await prompts({
      type: 'select',
      name: 'action',
      message: t('cli.move.categoryPrompt', { category: listTypeTitle(category) }),
      choices,
    })) as ToggleResponse

    const action = response.action
    if (action === undefined || action === '__BACK__') break

    if (action === '__ALL_ON__') {
      toggleSetAll(
        enabledSet,
        lists.map((l) => l.filePath),
        true,
      )
      continue
    }

    if (action === '__ALL_OFF__') {
      if (requireAtLeastOne) {
        const allPaths = allLists.map((l) => l.filePath)
        const otherEnabled = allPaths.filter(
          (p) => enabledSet.has(p) && !lists.some((l) => l.filePath === p),
        )
        if (otherEnabled.length === 0) {
          console.log(t('cli.move.keepOneDestination'))
          continue
        }
      }
      toggleSetAll(
        enabledSet,
        lists.map((l) => l.filePath),
        false,
      )
      continue
    }

    // Toggle individual item
    const targetPath = action
    if (enabledSet.has(targetPath)) {
      if (requireAtLeastOne) {
        const remaining = allLists.filter(
          (l) => enabledSet.has(l.filePath) && l.filePath !== targetPath,
        )
        if (remaining.length === 0) {
          console.log(t('cli.move.keepOneDestination'))
          continue
        }
      }
      enabledSet.delete(targetPath)
    } else {
      enabledSet.add(targetPath)
    }
  }
}
