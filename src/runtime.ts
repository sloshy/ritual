let cachedSourceMode: boolean | null = null

/**
 * True when running via `bun script.ts` from a source checkout, false when
 * running the compiled `ritual` binary produced by `bun build --compile`.
 *
 * Detection: in a compiled binary `Bun.main` resolves to an embedded virtual
 * path (`/$bunfs/...` on Unix, `B:\~BUN\...` on Windows); in source mode it
 * points to a real file on disk. Robust across bun being aliased / renamed
 * and across custom-named compiled binaries.
 */
export function isRunningFromSource(): boolean {
  if (cachedSourceMode !== null) return cachedSourceMode
  const main = Bun.main
  const isEmbedded = main.startsWith('/$bunfs/') || main.startsWith('B:\\~BUN\\')
  cachedSourceMode = !isEmbedded
  return cachedSourceMode
}
