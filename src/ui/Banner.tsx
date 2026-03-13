import React from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import chalk from 'chalk';

const teal = chalk.hex('#4ecdc4');

const BANNER_LINES = [
  ' ██████╗██╗   ██╗██╗  ██╗██╗████████╗',
  '██╔════╝██║   ██║██║ ██╔╝██║╚══██╔══╝',
  '██║     ██║   ██║█████╔╝ ██║   ██║',
  '██║     ╚██╗ ██╔╝██╔═██╗ ██║   ██║',
  '╚██████╗ ╚████╔╝ ██║  ██╗██║   ██║',
  ' ╚═════╝  ╚═══╝  ╚═╝  ╚═╝╚═╝   ╚═╝'
] as const;

export function Banner({version}: {version: string}): React.JSX.Element {
  const {exit} = useApp();

  useInput((_input, key) => {
    if (key.return) {
      exit();
    }
  });

  return (
    <Box flexDirection="column" paddingY={1}>
      {BANNER_LINES.map((line) => (
        <Text key={line}>{teal(line)}</Text>
      ))}
      <Text>{chalk.dim(teal('C O M P U T E R   V I S I O N   T O O L K I T'))}</Text>
      <Text color="gray">{`* Welcome to cvkit v${version} — Press Enter to continue`}</Text>
    </Box>
  );
}
