/**
 * @fileoverview Enforce AGENTS.md rule #2: object types must be declared via
 * a `type` or `interface` — never left as anonymous inline shapes.
 *
 * The rule flags every `TSTypeLiteral` (i.e. `{ … }` used in a type position)
 * unless one of its ancestors is a `type` or `interface` declaration, where
 * declaring named object shapes is the whole point.
 *
 * ✅ Allowed:
 *   type Point = { x: number; y: number }
 *   interface Point { x: number; y: number }
 *   type Either = string | { kind: 'err'; msg: string }   // inside a type alias
 *
 * ❌ Flagged:
 *   function f(): { x: number } { ... }            // function return type
 *   const p: { x: number } = { x: 0 }              // variable annotation
 *   function f(x: { a: number }) { ... }           // parameter type
 *   const x = obj as { id: string }                // cast target
 *   const arr: Array<{ id: string }> = []          // generic argument
 *
 * Empty literals (`{}`) are not flagged — they're typically used for the
 * "any non-nullish object" idiom and don't introduce a structural shape.
 *
 * Scope note: the rule is AST-only and therefore does NOT flag *inferred*
 * anonymous object shapes (`const x = { a: 1 }` — TS infers `{ a: number }`
 * with no explicit annotation). Detecting those would require type-checker
 * access; they're deliberately out of scope.
 */

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow anonymous inline object types outside of type/interface declarations',
    },
    messages: {
      anonymous:
        'Anonymous object types are not allowed here. Extract this shape into a named `type` or `interface` declaration.',
    },
    schema: [],
  },

  create(context) {
    function isInsideTypeDeclaration(node) {
      let parent = node.parent
      while (parent) {
        if (parent.type === 'TSTypeAliasDeclaration' || parent.type === 'TSInterfaceDeclaration') {
          return true
        }
        parent = parent.parent
      }
      return false
    }

    return {
      TSTypeLiteral(node) {
        // Empty `{}` is idiomatic for "any non-nullish object" — not a shape.
        if (node.members.length === 0) return
        if (isInsideTypeDeclaration(node)) return
        context.report({ node, messageId: 'anonymous' })
      },
    }
  },
}
