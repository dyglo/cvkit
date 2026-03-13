import React from 'react';
import {Box, Text} from 'ink';
import {Command} from 'commander';
import {getConfigPath, isSecretKey, maskConfigValue, readConfig, setConfigValue} from '../lib/config.js';
import {renderOnce} from '../lib/render.js';
import {Table} from '../ui/Table.js';

export function registerConfig(program: Command): void {
  const config = program.command('config').description('Manage cvkit configuration');

  config
    .command('set')
    .description('Set a config key')
    .argument('<keyValue>', 'KEY=VALUE')
    .action(async (keyValue: string) => {
      const separatorIndex = keyValue.indexOf('=');
      if (separatorIndex <= 0) {
        throw new Error('Expected KEY=VALUE.');
      }

      const key = keyValue.slice(0, separatorIndex).trim();
      const value = keyValue.slice(separatorIndex + 1).trim();
      if (!key || !value) {
        throw new Error('Expected KEY=VALUE.');
      }

      await setConfigValue(key, value);
      const preview = isSecretKey(key) ? maskConfigValue(key, value) : value;
      await renderOnce(
        <Box paddingLeft={2}>
          <Text color="green">{`✓ ${key} saved to ${getConfigPath()} (${preview})`}</Text>
        </Box>
      );
    });

  config
    .command('list')
    .description('List config keys')
    .action(async () => {
      const values = await readConfig();
      const rows = Object.entries(values)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => ({
          label: key,
          value: maskConfigValue(key, value)
        }));

      await renderOnce(
        rows.length > 0 ? (
          <Table rows={rows} />
        ) : (
          <Box paddingLeft={2}>
            <Text color="gray">No config values set.</Text>
          </Box>
        )
      );
    });
}
