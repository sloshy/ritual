import { Command } from 'commander'
import path from 'node:path'
import fs from 'node:fs/promises'
import { startAdminServer } from '../admin/server'

type AdminCommandOptions = {
  port: string
  host: string
}

export function registerAdminCommand(program: Command) {
  program
    .command('admin')
    .description('Start the web admin interface')
    .option('-p, --port <number>', 'Port to serve on', '8080')
    .option('--host <address>', 'Host address to bind to', '0.0.0.0')
    .action(async (options: AdminCommandOptions) => {
      const port = parseInt(options.port, 10)
      const host = options.host
      const adminDistDir = path.join(process.cwd(), '.admin-dist')

      console.log('Building admin interface...')

      await fs.rm(adminDistDir, { recursive: true, force: true })
      await fs.mkdir(adminDistDir, { recursive: true })

      // Bundle admin SPA
      const buildResult = await Bun.build({
        entrypoints: [path.join(import.meta.dir, '../admin/site/app.tsx')],
        outdir: adminDistDir,
        target: 'browser',
        format: 'esm',
        minify: true,
        naming: 'app.js',
        define: {
          'process.env.NODE_ENV': '"production"',
        },
        jsx: {
          runtime: 'automatic',
          importSource: 'preact',
        },
      })

      if (!buildResult.success) {
        console.error('Admin SPA build failed:')
        for (const log of buildResult.logs) {
          console.error(log)
        }
        process.exit(1)
      }

      // Build Tailwind CSS
      const { execSync } = await import('node:child_process')
      const stylesInput = path.join(import.meta.dir, '../admin/site/styles.css')
      const stylesOutput = path.join(adminDistDir, 'styles.css')
      try {
        execSync(
          `bun run node_modules/.bin/tailwindcss -i ${stylesInput} -o ${stylesOutput} --minify`,
          {
            cwd: process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        )
      } catch (cssError) {
        console.warn('Tailwind CSS build failed, using fallback styles:', cssError)
        // Fallback: write minimal CSS if tailwindcss CLI isn't available
        await Bun.write(
          stylesOutput,
          `*,::after,::before{box-sizing:border-box;border:0 solid}:root{--bg-body:oklch(20% .02 260);--bg-panel:oklch(24% .025 260);--bg-hover:oklch(30% .03 260);--bg-active:oklch(38% .06 280);--bg-subtle:oklch(18% .02 260);--border:oklch(35% .03 260);--border-hover:oklch(50% .12 280);--text-primary:oklch(85% .01 260);--text-secondary:oklch(70% .02 260);--text-muted:oklch(55% .02 260);--text-accent:oklch(75% .12 280);--text-dim:oklch(60% .02 260);--accent:oklch(75% .12 280);--accent-dim:oklch(55% .08 280);--btn-bg:oklch(30% .03 260);--btn-hover:oklch(38% .03 260);--btn-text:oklch(80% .01 260);--btn-primary:oklch(55% .15 280);--btn-primary-hover:oklch(50% .15 280);--success-bg:rgba(20,83,45,.5);--success-border:#15803d;--success-text:#86efac;--error-bg:rgba(127,29,29,.5);--error-border:#b91c1c;--error-text:#fca5a5}body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:var(--bg-body);color:var(--text-primary)}.grid{display:grid}.gap-4{gap:1rem}.grid-cols-1{grid-template-columns:repeat(1,minmax(0,1fr))}@media(min-width:640px){.sm\\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(min-width:1024px){.lg\\:grid-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}}.admin-header{background:var(--bg-panel);border-bottom:1px solid var(--border);padding:.75rem 1rem;display:flex;align-items:center;justify-content:space-between}.admin-logo{font-size:1rem;font-weight:700;color:var(--text-accent)}.admin-sidebar{background:var(--bg-panel);border-right:1px solid var(--border)}.admin-nav-item{display:flex;align-items:center;gap:.625rem;width:100%;padding:.5rem 1rem;font-size:.8125rem;color:var(--text-secondary);border:none;border-left:3px solid transparent;background:none;cursor:pointer;transition:background .15s,color .15s;text-align:left}.admin-nav-item:hover{background:var(--bg-hover);color:var(--text-primary)}.admin-nav-item[data-active=true]{background:oklch(30% .04 280);color:var(--text-accent);border-left-color:var(--accent);font-weight:500}.nav-icon{font-size:1rem;width:1.25rem;text-align:center;flex-shrink:0}.admin-card{background:var(--bg-panel);border:1px solid var(--border);border-radius:.5rem;padding:1rem;text-align:left;cursor:pointer;transition:transform .15s,box-shadow .15s,border-color .15s}.admin-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.35);border-color:var(--border-hover)}.admin-card-icon{font-size:1.5rem;margin-bottom:.5rem}.admin-card-title{font-weight:500;color:var(--text-primary)}.admin-card-desc{font-size:.8125rem;color:var(--text-muted);margin-top:.25rem}.btn{display:inline-flex;align-items:center;justify-content:center;padding:.5rem 1.25rem;border-radius:.375rem;font-size:.8125rem;font-weight:500;border:none;cursor:pointer;transition:background .15s,opacity .15s}.btn:disabled{opacity:.5;cursor:not-allowed}.btn-primary{background:var(--btn-primary);color:#fff}.btn-primary:hover:not(:disabled){background:var(--btn-primary-hover)}.btn-secondary{background:var(--btn-bg);color:var(--btn-text)}.btn-secondary:hover:not(:disabled){background:var(--btn-hover);color:#fff}.btn-danger{background:oklch(45% .15 25);color:#fff}.btn-danger:hover:not(:disabled){background:oklch(40% .15 25)}.form-input{width:100%;padding:.5rem .75rem;background:var(--bg-hover);border:1px solid var(--border);border-radius:.375rem;color:var(--text-primary);font-size:.8125rem;outline:none;transition:border-color .15s}.form-input:focus{border-color:var(--accent)}.form-input::placeholder{color:var(--text-muted)}.form-label{display:block;font-size:.8125rem;color:var(--text-secondary);margin-bottom:.25rem}.form-hint{font-size:.75rem;color:var(--text-muted)}.alert{padding:.5rem .75rem;border-radius:.375rem;font-size:.8125rem;border:1px solid;margin-bottom:.75rem}.alert-success{background:var(--success-bg);border-color:var(--success-border);color:var(--success-text)}.alert-error{background:var(--error-bg);border-color:var(--error-border);color:var(--error-text)}.section-heading{font-size:1.5rem;font-weight:700;margin-bottom:1rem;color:var(--text-primary)}.section-subheading{font-size:1.0625rem;font-weight:500;margin-top:1.5rem;margin-bottom:.5rem;padding-bottom:.375rem;border-bottom:2px solid oklch(35% .04 280);color:var(--text-accent)}.page-desc{color:var(--text-secondary);margin-bottom:1rem;font-size:.875rem}.checkbox-label{display:flex;align-items:center;gap:.5rem;font-size:.8125rem;color:var(--text-secondary)}.progress-track{width:100%;height:.625rem;background:var(--bg-panel);border:1px solid var(--border);border-radius:9999px;overflow:hidden}.progress-fill{height:100%;border-radius:9999px;background:linear-gradient(90deg,var(--accent),oklch(70% .15 200));transition:width .3s ease}.progress-stages{display:flex;flex-direction:column;gap:.5rem;margin-top:1rem}.progress-stage{display:flex;align-items:center;gap:.5rem;font-size:.8125rem;color:var(--text-muted);transition:color .2s}.progress-stage[data-status=active]{color:var(--text-accent)}.progress-stage[data-status=done]{color:var(--success-text)}.progress-stage-icon{width:1.25rem;text-align:center;flex-shrink:0}.audit-table{width:100%;border-collapse:collapse;font-size:.8125rem}.audit-table th{text-align:left;padding:.5rem .75rem;color:var(--text-muted);font-weight:500;border-bottom:1px solid var(--border)}.audit-table td{padding:.5rem .75rem;border-bottom:1px solid oklch(28% .02 260);color:var(--text-secondary)}.audit-table tr:hover td{background:oklch(28% .025 260)}.badge{display:inline-block;padding:.125rem .5rem;border-radius:9999px;font-size:.75rem;font-weight:500}.badge-success{background:var(--success-bg);color:#4ade80}.badge-error{background:var(--error-bg);color:#f87171}.mobile-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:40}.mobile-nav{position:fixed;top:0;left:0;bottom:0;width:16rem;background:var(--bg-panel);border-right:1px solid var(--border);z-index:50;overflow-y:auto;padding-top:.75rem}@media(max-width:767px){.desktop-only{display:none!important}}@media(min-width:768px){.mobile-only{display:none!important}}`,
        )
      }

      // Generate index.html
      const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ritual Admin</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="app.js"></script>
</body>
</html>`
      await Bun.write(path.join(adminDistDir, 'index.html'), indexHtml)

      console.log('Admin interface built successfully.')

      startAdminServer({ port, host, distDir: adminDistDir })
    })
}
