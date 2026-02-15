---
description: Remove verbose internal-monologue comments while preserving useful documentation.
agent: agent
---

# Clean Code Comments

Scan target files and remove or rewrite comments that read like internal monologue while preserving meaningful technical context.

## Steps

1. Scan the selected files or module.
2. Identify internal-monologue comments, including:
   - First-person narration
   - Uncertainty or open questioning
   - Planning/brainstorming notes
   - Conversational commentary
3. Refine or remove:
   - Remove comments that do not help understand final code
   - Rewrite wordy comments into concise, professional comments
   - Keep short useful comments unless redundant
4. Preserve:
   - JSDoc/TSDoc
   - Edge-case warnings
   - `TODO`/`FIXME` items unless completed
5. Verify:
   - No code accidentally removed or commented out
   - Code still compiles/runs
