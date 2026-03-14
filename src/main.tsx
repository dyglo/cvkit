import process from 'node:process';
import React from 'react';
import {render} from 'ink';
import {buildCLI} from './program.js';
import {PACKAGE_VERSION} from './lib/package.js';
import {Banner} from './ui/Banner.js';

const BANNER_LINES = [
  ' ██████╗██╗   ██╗██╗  ██╗██╗████████╗',
  '██╔════╝██║   ██║██║ ██╔╝██║╚══██╔══╝',
  '██║     ██║   ██║█████╔╝ ██║   ██║',
  '██║     ╚██╗ ██╔╝██╔═██╗ ██║   ██║',
  '╚██████╗ ╚████╔╝ ██║  ██╗██║   ██║',
  ' ╚═════╝  ╚═══╝  ╚═╝  ╚═╝╚═╝   ╚═╝'
] as const;

export async function runCliApp(): Promise<void> {
  const program = buildCLI();

  if (process.argv.length <= 2) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      const app = render(<Banner version={PACKAGE_VERSION} />, {
        stdout: process.stdout,
        stdin: process.stdin,
        patchConsole: false,
        exitOnCtrlC: true
      });
      await app.waitUntilExit();
      app.clear();
    } else {
      for (const line of BANNER_LINES) {
        process.stdout.write(`${line}\n`);
      }
      process.stdout.write('C O M P U T E R   V I S I O N   T O O L K I T\n');
      process.stdout.write(`* Welcome to cvkit v${PACKAGE_VERSION} - Press Enter to continue\n`);
      await waitForEnterOrEof();
    }

    program.outputHelp();
    return;
  }

  await program.parseAsync(process.argv);
}

export function handleFatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : 'Unexpected error.';
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
}

async function waitForEnterOrEof(): Promise<void> {
  await new Promise<void>((resolve) => {
    const onData = (chunk: Buffer | string) => {
      const text = String(chunk);
      if (text.includes('\n') || text.includes('\r')) {
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
