import {Command} from 'commander';
import {PACKAGE_VERSION} from './lib/package.js';
import {registerInspect} from './commands/inspect.js';
import {registerConfig} from './commands/config.js';
import {registerDataset} from './commands/dataset.js';
import {registerConvert} from './commands/convert.js';

export function buildCLI(): Command {
  const program = new Command();

  program
    .name('cvkit')
    .description('Computer Vision Toolkit')
    .version(PACKAGE_VERSION, '--version', 'Output the current version')
    .showHelpAfterError();

  registerInspect(program);
  registerConfig(program);
  registerDataset(program);
  registerConvert(program);

  return program;
}
