import process from 'node:process';
import {createInterface} from 'node:readline';
import React from 'react';
import {render} from 'ink';
import {buildCLI} from './program.js';
import {PACKAGE_VERSION} from './lib/package.js';
import {renderInteractive} from './lib/render.js';
import {routeCommand} from './repl/router.js';
import {Repl} from './repl/Repl.js';
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

  if (process.argv.length > 2) {
    await program.parseAsync(process.argv);
    return;
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    await renderBanner();
    await renderInteractive(<Repl />);
    return;
  }

  await runLineRepl();
}

export function handleFatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : 'Unexpected error.';
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
}

async function renderBanner(): Promise<void> {
  const app = render(<Banner version={PACKAGE_VERSION} />, {
    stdout: process.stdout,
    stdin: process.stdin,
    patchConsole: false,
    exitOnCtrlC: true
  });
  await app.waitUntilExit();
  app.clear();
}

async function runLineRepl(): Promise<void> {
  renderBannerLines();

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  try {
    const iterator = readline[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) {
      return;
    }

    writePrompt();

    for await (const line of iterator) {
      process.stdout.write(`${line}\n`);

      const result = await routeCommand(line);
      const shouldContinue = await writeLineReplResult(result);
      if (!shouldContinue) {
        return;
      }

      writePrompt();
    }
  } finally {
    readline.close();
  }
}

function renderBannerLines(): void {
  for (const line of BANNER_LINES) {
    process.stdout.write(`${line}\n`);
  }

  process.stdout.write('C O M P U T E R   V I S I O N   T O O L K I T\n');
  process.stdout.write(`* Welcome to cvkit v${PACKAGE_VERSION} — Press Enter to continue\n`);
}

async function writeLineReplResult(
  result: Awaited<ReturnType<typeof routeCommand>>
): Promise<boolean> {
  switch (result.type) {
    case 'empty':
      return true;
    case 'output':
      process.stdout.write(`\n${indentBlock(result.message)}\n\n`);
      return true;
    case 'error':
      process.stdout.write(`\n${indentBlock(result.message)}\n\n`);
      return true;
    case 'exit':
      process.stdout.write(`\n  ${result.message}\n`);
      return false;
  }
}

function writePrompt(): void {
  process.stdout.write('> ');
}

function indentBlock(content: string): string {
  return content
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}
