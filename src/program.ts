import {Command} from 'commander';
import {PACKAGE_VERSION} from './lib/package.js';
import {registerInspect} from './commands/inspect.js';
import {registerConfig} from './commands/config.js';

export function buildCLI(): Command {
  const program = new Command();

  program
    .name('cvkit')
    .description('Computer Vision Toolkit')
    .version(PACKAGE_VERSION, '--version', 'Output the current version')
    .addHelpCommand(false)
    .showHelpAfterError();

  registerInspect(program);
  registerConfig(program);

  return program;
}
