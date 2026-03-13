import process from 'node:process';
import React from 'react';
import {Box, Text, render, useApp, useInput} from 'ink';
import chalk from 'chalk';
import {getPackageVersion} from '../lib/package.js';

const teal = chalk.hex('#4ecdc4');

const banner = [
  ' ██████╗██╗   ██╗██╗  ██╗██╗████████╗',
  '██╔════╝██║   ██║██║ ██╔╝██║╚══██╔══╝',
  '██║     ██║   ██║█████╔╝ ██║   ██║',
  '██║     ╚██╗ ██╔╝██╔═██╗ ██║   ██║',
  '╚██████╗ ╚████╔╝ ██║  ██╗██║   ██║',
  ' ╚═════╝  ╚═══╝  ╚═╝  ╚═╝╚═╝   ╚═╝'
] as const;

function SplashScreen({version}: {version: string}): React.JSX.Element {
  const {exit} = useApp();

  useInput((input, key) => {
    if (key.return || input === '\r') {
      exit();
    }
  });

  return (
    <Box flexDirection="column" paddingY={1}>
      {banner.map((line) => (
        <Text key={line}>{teal(line)}</Text>
      ))}
      <Text>{teal('C O M P U T E R   V I S I O N   T O O L K I T')}</Text>
      <Text>{teal(`* Welcome to cvkit v${version} - Press Enter to continue`)}</Text>
    </Box>
  );
}

export async function showSplashScreen(): Promise<void> {
  const version = await getPackageVersion();
  const content = [
    ...banner,
    'C O M P U T E R   V I S I O N   T O O L K I T',
    `* Welcome to cvkit v${version} - Press Enter to continue`
  ];

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    for (const line of content) {
      process.stdout.write(`${teal(line)}\n`);
    }

    await waitForEnterOrEof();
    return;
  }

  await new Promise<void>((resolve) => {
    const app = render(<SplashScreen version={version} />, {
      patchConsole: false,
      stdout: process.stdout,
      stdin: process.stdin
    });

    app.waitUntilExit().then(resolve);
  });
}

async function waitForEnterOrEof(): Promise<void> {
  await new Promise<void>((resolve) => {
    const onData = (chunk: Buffer | string) => {
      if (String(chunk).includes('\n') || String(chunk).includes('\r')) {
        cleanup();
      }
    };

    const onEnd = () => {
      cleanup();
    };

    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      resolve();
    };

    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.resume();
  });
}
