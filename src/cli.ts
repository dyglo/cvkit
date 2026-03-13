import {Command} from 'commander';
import {showSplashScreen} from './ui/splash.js';
import {registerConfigCommand} from './commands/config.js';
import {registerInspectCommand} from './commands/inspect.js';
import {registerPlaceholderCommands} from './commands/placeholders.js';
import {getPackageVersion} from './lib/package.js';
import {printErrorAndExit} from './lib/output.js';

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('cvkit')
    .description('Computer vision toolkit for terminal workflows.')
    .version(await getPackageVersion(), '-v, --version', 'output the current version')
    .showHelpAfterError();

  registerInspectCommand(program);
  registerConfigCommand(program);
  registerPlaceholderCommands(program);

  if (process.argv.length <= 2) {
    await showSplashScreen();
    program.outputHelp();
    return;
  }

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  printErrorAndExit(error);
});

