import { Command } from 'commander'
import licenseText from '../../LICENSE' with { type: 'text' }
import { t } from '../i18n/t'
import { displayWithPager, resolvePagerMode } from '../pager'

type LicenseOptions = {
  plain: boolean
}

export function registerLicenseCommand(program: Command): void {
  program
    .command('license')
    .description(t('help.license.description'))
    .option('--plain', t('help.license.plain'), false)
    .action(async (options: LicenseOptions) => {
      await displayWithPager(licenseText, resolvePagerMode(options.plain))
    })
}
