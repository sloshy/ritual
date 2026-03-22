import { Command } from 'commander'
import licenseText from '../../LICENSE' with { type: 'text' }
import { displayWithPager, resolvePagerMode } from '../pager'

type LicenseOptions = {
  plain: boolean
}

export function registerLicenseCommand(program: Command): void {
  program
    .command('license')
    .description('Display the Ritual project license (AGPLv3)')
    .option('--plain', 'Output directly to stdout without pager', false)
    .action(async (options: LicenseOptions) => {
      await displayWithPager(licenseText, resolvePagerMode(options.plain))
    })
}
