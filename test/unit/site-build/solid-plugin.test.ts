import type { BuildOutput } from 'bun'
import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { solidPlugin, type SolidPluginOptions } from '../../../src/site-build/solid-plugin'
import { createWorkspace, removeWorkspace } from '../../helpers/workspace'

/**
 * The in-repo Bun plugin over `@solidjs/compiler`: Solid's JSX compiled for the
 * DOM or the server, with the TypeScript the compiler passes through stripped
 * by Bun. Everything else about the output is the compiler's own business.
 */

const COMPONENT = `import type { JSX } from '@solidjs/web'
type GreetingProps = { name: string; count: number }
export function Greeting(props: GreetingProps): JSX.Element {
  const label = (props.count as number) > 1 ? 'many' : 'one'
  return <p class={label}>{props.name}</p>
}
`

type CompileResult = { entry: string; result: BuildOutput }

async function build(source: string, options: SolidPluginOptions): Promise<CompileResult> {
  const dir = await createWorkspace({ dirs: [], config: false })
  try {
    const entry = path.join(dir, 'greeting.tsx')
    await fs.writeFile(entry, source)
    const result = await Bun.build({
      entrypoints: [entry],
      external: ['@solidjs/web', 'solid-js'],
      plugins: [solidPlugin(options)],
      throw: false,
    })
    return { entry, result }
  } finally {
    await removeWorkspace(dir)
  }
}

async function compile(options: SolidPluginOptions): Promise<string> {
  const { result } = await build(COMPONENT, options)
  expect(result.success).toBe(true)
  return await result.outputs[0]!.text()
}

describe('solidPlugin', () => {
  test('compiles JSX to DOM templates from @solidjs/web and strips the types', async () => {
    const code = await compile({ generate: 'dom' })
    expect(code).toContain('@solidjs/web')
    expect(code).toContain('template(')
    expect(code).not.toContain('<p class=')
    expect(code).not.toContain('GreetingProps')
    expect(code).not.toContain('as number')
  })

  test('a file the compiler rejects fails the build, naming the file', async () => {
    const { entry, result } = await build('export const A = () => <div>\n', { generate: 'dom' })
    expect(result.success).toBe(false)
    const messages = result.logs.map((log) => log.message).join('\n')
    expect(messages).toContain('Could not compile the JSX in')
    expect(messages).toContain(entry)
  })

  test('compiles JSX to server rendering for generate: ssr', async () => {
    const code = await compile({ generate: 'ssr' })
    expect(code).toContain('ssr(')
    expect(code).not.toContain('template(')
  })
})
