---
description: Naming conventions and type definitions for TypeScript.
applyTo: '**/*.{ts,tsx}'
---

# Naming Conventions

## Interfaces

- Do not prefix interface names with `I` (use `CacheManager`, not `ICacheManager`).
- Use PascalCase for interface names.

## Imports

For imports from the Bun or Node standard library, always use the `node:` prefix. For example, importing `fs/promises` should be imported from `node:fs/promises` instead.

## Object Types

Object types must be explicitly defined using `type` or `interface` declarations — never left as implicit inline object shapes inferred by the compiler. This applies to function return types, variable declarations, and any other context where an object type would otherwise be anonymous.

```ts
// ✅ Correct
type Point = { x: number; y: number }
function getOrigin(): Point { return { x: 0, y: 0 } }

// ❌ Incorrect
function getOrigin(): { x: number; y: number } { return { x: 0, y: 0 } }
```
