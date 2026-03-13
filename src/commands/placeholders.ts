import {Command} from 'commander';

const RESERVED_COMMANDS = [
  'dataset',
  'convert',
  'describe',
  'anomaly',
  'detect',
  'augment',
  'run'
] as const;

export function registerPlaceholderCommands(program: Command): void {
  for (const name of RESERVED_COMMANDS) {
    program
      .command(name, {hidden: true})
      .allowUnknownOption()
      .action(() => {
        throw new Error(`The "${name}" command is reserved for a future phase and is not implemented yet.`);
      });
  }
}

