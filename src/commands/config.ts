import {Command} from 'commander';
import {ConfigStore} from '../lib/config-store.js';
import {formatConfigList, formatConfigPath} from '../lib/output.js';

export function registerConfigCommand(program: Command): void {
  const config = program
    .command('config')
    .description('Manage cvkit configuration');

  config
    .command('set')
    .description('Store a configuration value')
    .argument('<entry>', 'KEY=VALUE pair')
    .action(async (entry: string) => {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
        throw new Error('Expected KEY=VALUE.');
      }

      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();

      if (!key || !value) {
        throw new Error('Both KEY and VALUE must be non-empty.');
      }

      const store = new ConfigStore();
      await store.set(key, value);

      process.stdout.write(`Saved ${key} to ${formatConfigPath(store.filePath)}\n`);
    });

  config
    .command('list')
    .description('List stored configuration')
    .action(async () => {
      const store = new ConfigStore();
      const values = await store.listMasked();

      process.stdout.write(`${formatConfigList(values)}\n`);
    });
}

