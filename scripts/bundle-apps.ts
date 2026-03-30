import path from 'node:path'
import { SolidPlugin } from '@dschz/bun-plugin-solid'

const srcDir = path.join(import.meta.dir, '..', 'src')

type BundleTarget = {
  name: string
  entrypoint: string
  outdir: string
  outfile: string
}

const targets: BundleTarget[] = [
  {
    name: 'site',
    entrypoint: path.join(srcDir, 'site', 'app.tsx'),
    outdir: path.join(srcDir, 'site'),
    outfile: 'app.compiled.js',
  },
  {
    name: 'admin',
    entrypoint: path.join(srcDir, 'admin', 'site', 'app.tsx'),
    outdir: path.join(srcDir, 'admin', 'site'),
    outfile: 'app.compiled.js',
  },
]

let failed = false

for (const target of targets) {
  console.log(`Bundling ${target.name} SPA...`)

  const result = await Bun.build({
    entrypoints: [target.entrypoint],
    outdir: target.outdir,
    target: 'browser',
    format: 'esm',
    minify: true,
    naming: target.outfile,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    plugins: [SolidPlugin()],
  })

  if (!result.success) {
    console.error(`${target.name} SPA bundle failed:`)
    for (const log of result.logs) {
      console.error(log)
    }
    failed = true
    continue
  }

  console.log(`  → ${path.join(target.outdir, target.outfile)}`)
}

if (failed) {
  process.exit(1)
}

console.log('All SPA bundles built successfully.')
