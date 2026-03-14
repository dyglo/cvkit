import {Command} from 'commander';
import {PACKAGE_VERSION} from './lib/package.js';
import {registerAnomaly} from './commands/anomaly.js';
import {registerHistory} from './commands/history.js';
import {registerInspect} from './commands/inspect.js';
import {registerLabelAssist} from './commands/label-assist.js';
import {registerConfig} from './commands/config.js';
import {registerDataset} from './commands/dataset.js';
import {registerConvert} from './commands/convert.js';
import {registerDescribe} from './commands/describe.js';
import {registerAsk} from './commands/ask.js';

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
  registerDescribe(program);
  registerAsk(program);
  registerAnomaly(program);
  registerLabelAssist(program);
  registerHistory(program);

  return program;
}
