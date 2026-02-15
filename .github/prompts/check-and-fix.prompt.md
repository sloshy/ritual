---
description: Check and fix formatting, linting, and compiler errors.
agent: agent
---

# Check and Fix

Run standard quality checks and fix issues in sequence.

## Steps

1. Run formatting checks: `bun run check-format`.
2. If formatting issues exist, run: `bun run format`.
3. Run TypeScript compiler checks: `bunx tsc --noEmit`.
4. Fix reported compiler/lint issues and re-run checks until clean.
