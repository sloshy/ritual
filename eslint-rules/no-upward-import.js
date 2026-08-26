/**
 * @fileoverview Enforce a directory layering for relative imports inside `src/`.
 *
 * The layer table is ordered bottom-up. A file may import from its own layer or
 * any layer below it, never a layer above — that is the one-way dependency
 * direction research/simplification-zones-2026-08-26.md (Zone 2) wants between
 * the domain core, the shared editor engine, the two SPAs and the entry points.
 * Directories that appear in no layer are unconstrained, both as importer and
 * as target, so the table can be tightened one zone at a time.
 *
 * Only relative specifiers are examined: a bare specifier is a package, and a
 * package cannot be "above" anything in `src/`. The specifier is resolved
 * against the importing file's directory, so `../site/combined-list` from
 * `src/editor/x.ts` is judged as `src/site/combined-list`.
 *
 * ✅ Allowed (with layers [domain] < [editor] < [apps]):
 *   src/site/DeckPage.tsx:     import { useEditor } from '../editor/useEditor'
 *   src/editor/commit.ts:      import { applyChanges } from '../list/list-mutate'
 *   src/admin/api/x.ts:        import { foo } from '../../site/data-types'   // same layer
 *
 * ❌ Flagged:
 *   src/editor/DeckEditController.tsx: import { DeckPage } from '../site/DeckPage'
 *   src/list/list-mutate.ts:           import { … } from '../editor/apply-batch'
 *
 * The `allow` option lists exact (from, to) fragment pairs for known debts so
 * the rule can sit at `error` while later zones burn the list down. Entries are
 * meant to be deleted, never widened; an entry that no longer matches any
 * import is inert, so prune `allow` whenever a zone closes.
 */

import path from 'node:path'

/** Windows gives ESLint backslash-separated paths; fragments are always POSIX. */
function normalizePath(filename) {
  return filename.replace(/\\/g, '/')
}

/**
 * Whether a normalized path sits at or under `fragment`.
 *
 * Both sides are repo-relative (see {@link relativeToRoot}), so this is a plain
 * segment-aware prefix test: `src/site` must not claim `src/site-build/x.ts`, and
 * a fragment may name a single module (`src/list/list-mutate`) so a debt can be
 * scoped to one file. Import targets carry no extension, so the file form is
 * compared without one.
 */
function matchesFragment(relative, fragment) {
  const frag = fragment.replace(/\/+$/, '')
  const bare = relative.replace(/\.(m|c)?[tj]sx?$/, '')
  return relative === frag || bare === frag || relative.startsWith(`${frag}/`)
}

/**
 * ESLint reports absolute filenames; the layer table is written repo-relative.
 * Strip the project root so a checkout path that happens to contain a
 * `src/<layer>/` segment cannot misclassify every file beneath it. A filename
 * that is already relative (RuleTester) is returned as-is.
 */
function relativeToRoot(filename, root) {
  const normalizedRoot = normalizePath(root).replace(/\/+$/, '')
  return filename.startsWith(`${normalizedRoot}/`)
    ? filename.slice(normalizedRoot.length + 1)
    : filename
}

/**
 * The layer a normalized path belongs to, or `undefined` when no layer names it.
 *
 * When several fragments match (`src/site` and `src/site/details` in different
 * layers) the longest wins, so a sub-directory can be placed independently of
 * its parent.
 */
function findLayer(normalized, layers) {
  let best
  layers.forEach((layer, index) => {
    for (const dir of layer.dirs) {
      if (!matchesFragment(normalized, dir)) continue
      if (best === undefined || dir.length > best.dir.length) {
        best = { index, name: layer.name, dir }
      }
    }
  })
  return best
}

/** Resolve a relative specifier against the importing file, POSIX-style. */
function resolveSpecifier(filename, specifier) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(filename), specifier))
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow relative imports from a higher directory layer',
    },
    messages: {
      upwardImport:
        "'{{specifier}}' is in layer '{{toLayer}}' ({{toDir}}), above this file's layer '{{fromLayer}}' ({{fromDir}}). Move the shared code down, or import it from a higher layer.",
    },
    schema: [
      {
        type: 'object',
        properties: {
          layers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                dirs: { type: 'array', items: { type: 'string' }, minItems: 1 },
              },
              required: ['name', 'dirs'],
              additionalProperties: false,
            },
          },
          allow: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from: { type: 'string' },
                to: { type: 'string' },
              },
              required: ['from', 'to'],
              additionalProperties: false,
            },
          },
          ignoreTypeImports: { type: 'boolean' },
        },
        required: ['layers'],
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] ?? { layers: [] }
    const layers = options.layers
    const allow = options.allow ?? []
    const ignoreTypeImports = options.ignoreTypeImports ?? false

    const filename = relativeToRoot(
      normalizePath(context.filename ?? context.getFilename()),
      context.cwd,
    )
    const fromLayer = findLayer(filename, layers)
    // A file outside every layer is unconstrained.
    if (fromLayer === undefined) return {}

    function isAllowed(target) {
      return allow.some(
        ({ from, to }) => matchesFragment(filename, from) && matchesFragment(target, to),
      )
    }

    function check(source, isTypeOnly) {
      if (source === null || source === undefined || source.type !== 'Literal') return
      if (typeof source.value !== 'string' || !source.value.startsWith('.')) return
      if (ignoreTypeImports && isTypeOnly) return

      const target = resolveSpecifier(filename, source.value)
      const toLayer = findLayer(target, layers)
      if (toLayer === undefined || toLayer.index <= fromLayer.index) return
      if (isAllowed(target)) return

      context.report({
        node: source,
        messageId: 'upwardImport',
        data: {
          specifier: source.value,
          fromLayer: fromLayer.name,
          fromDir: fromLayer.dir,
          toLayer: toLayer.name,
          toDir: toLayer.dir,
        },
      })
    }

    return {
      ImportDeclaration(node) {
        check(node.source, node.importKind === 'type')
      },
      ExportNamedDeclaration(node) {
        check(node.source, node.exportKind === 'type')
      },
      ExportAllDeclaration(node) {
        check(node.source, node.exportKind === 'type')
      },
      ImportExpression(node) {
        check(node.source, false)
      },
      // `type T = import('../site/x').Y` — the type-position form.
      TSImportType(node) {
        const arg = node.argument
        check(arg.type === 'TSLiteralType' ? arg.literal : arg, true)
      },
    }
  },
}
