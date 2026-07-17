import { Command } from 'commander'
import path from 'node:path'
import { SKILLS, selectSkills } from '../skills/catalog'
import { installSkills, resolveSkillsDir } from '../skills/install'
import { ExitCode } from './scripting'

type SkillsInstallOptions = {
  global?: boolean
  dir?: string
  force?: boolean
}

export function registerSkillsCommand(program: Command): void {
  const skills = program
    .command('skills')
    .description(
      'Install Claude Code agent skills that teach AI agents how to drive Ritual from a local workspace',
    )

  skills
    .command('list')
    .description('List the available Ritual skills')
    .action(() => {
      for (const skill of SKILLS) {
        console.log(skill.name)
        console.log(`  ${skill.description}`)
        console.log('')
      }
    })

  skills
    .command('install [names...]')
    .description(
      'Install Ritual skills into .claude/skills (or ~/.claude/skills with --global). Installs every skill when no names are given.',
    )
    .option('--global', 'Install into ~/.claude/skills instead of the project directory')
    .option(
      '--dir <path>',
      'Project directory that should contain .claude/skills (defaults to the base dir)',
    )
    .option('-f, --force', 'Overwrite skill files that already exist')
    .action(async (names: string[], options: SkillsInstallOptions) => {
      const selected = selectSkills(names)
      if (typeof selected === 'string') {
        console.error(selected)
        process.exitCode = ExitCode.UsageError
        return
      }

      const skillsDir = resolveSkillsDir({ global: options.global, dir: options.dir })
      const results = await installSkills(selected, skillsDir, { force: options.force ?? false })

      const written = results.filter((result) => result.status === 'written')
      const skipped = results.filter((result) => result.status === 'skipped')

      const displayPath = (filePath: string): string => {
        const relative = path.relative(process.cwd(), filePath)
        return relative.startsWith('..') ? filePath : relative
      }

      for (const result of written) {
        console.log(`✓ ${result.name} → ${displayPath(result.path)}`)
      }
      for (const result of skipped) {
        console.log(`• ${result.name} already present (skipped)`)
      }

      console.log('')
      console.log(
        `Installed ${written.length} skill${written.length === 1 ? '' : 's'} to ${skillsDir}`,
      )
      if (skipped.length > 0) {
        console.log(
          `${skipped.length} already present; re-run with --force to overwrite with the current version.`,
        )
      }
    })
}
