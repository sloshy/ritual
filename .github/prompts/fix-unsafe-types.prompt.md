---
description: Identify and fix unsafe TypeScript type usage like `any` without breaking behavior.
agent: agent
---

# Fix Unsafe Types

Find and reduce unsafe type usage in TypeScript files conservatively.

## Steps

1. Search `src/` for unsafe patterns such as `: any`, `as any`, and `<any>`.
2. For each occurrence:
   - Inspect surrounding code and related types
   - Infer a safer specific type from initialization, function signatures, and interfaces
   - Skip changes if safe inference is not possible without behavior risk
3. Apply minimal changes that preserve behavior.
4. Validate with build/type checks (for example `bun run build` or `bunx tsc --noEmit`).
5. If a change introduces errors, revert that change and move to the next case.
