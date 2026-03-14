import process from 'node:process';
import {createInterface} from 'node:readline';
import React from 'react';
import {render} from 'ink';
import chalk from 'chalk';
import {
  type AILoopOptions,
  resumeAILoopAfterConfirmation,
  runAILoopSession,
  type ConversationMessage
} from './ai/loop.js';
import {loadEnvFile} from './lib/env.js';
import {buildCLI} from './program.js';
import {PACKAGE_VERSION} from './lib/package.js';
import {renderInteractive} from './lib/render.js';
import {detectWorkspace} from './lib/workspace.js';
import {routeCommand} from './repl/router.js';
import {Repl} from './repl/Repl.js';
import {Banner} from './ui/Banner.js';
import type {Workspace} from './lib/workspace.js';
import type {ConfirmationRequest} from './repl/types.js';

const BANNER_LINES = [
  ' ██████╗██╗   ██╗██╗  ██╗██╗████████╗',
  '██╔════╝██║   ██║██║ ██╔╝██║╚══██╔══╝',
  '██║     ██║   ██║█████╔╝ ██║   ██║',
  '██║     ╚██╗ ██╔╝██╔═██╗ ██║   ██║',
  '╚██████╗ ╚████╔╝ ██║  ██╗██║   ██║',
  ' ╚═════╝  ╚═══╝  ╚═╝  ╚═╝╚═╝   ╚═╝'
] as const;

export async function runCliApp(): Promise<void> {
  loadEnvFile();
  const program = buildCLI();

  if (process.argv.length > 2) {
    await program.parseAsync(process.argv);
    return;
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    await renderBanner();
    const workspace = await detectWorkspace();
    await renderInteractive(<Repl workspace={workspace} />);
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

    const workspace = await detectWorkspace();
    writeWorkspaceSummary(workspace);
    writePrompt(workspace);
    let pendingConfirmation: ConfirmationRequest | null = null;
    let conversationHistory: ConversationMessage[] = [];

    for await (const line of iterator) {
      process.stdout.write(`${line}\n`);

      const result = await routeCommand(line, workspace, pendingConfirmation);
      pendingConfirmation = result.type === 'confirm' ? result.request : null;

      switch (result.type) {
        case 'ai': {
          const historyBefore = conversationHistory;
          const historyWithUser = appendConversationMessage(conversationHistory, {
            role: 'user',
            content: line.trim()
          });
          conversationHistory = historyWithUser;
          const controller = createLineAILoopController(workspace);
          let aiResult: Awaited<ReturnType<typeof runAILoopSession>> & {wasStreamed: boolean};

          try {
            aiResult = await runLineAI(
              () => runAILoopSession(line.trim(), historyBefore, controller.options),
              controller
            );
          } catch (error: unknown) {
            conversationHistory = historyBefore;
            process.stdout.write(
              `\n${indentBlock(error instanceof Error ? error.message : 'Unexpected error.')}\n\n`
            );
            pendingConfirmation = null;
            break;
          }

          if (aiResult.status === 'completed') {
            const assistantMessage = aiResult.text || 'No response.';
            if (!aiResult.wasStreamed) {
              process.stdout.write(`\n${indentBlock(assistantMessage)}\n\n`);
            } else {
              process.stdout.write('\n\n');
            }

            conversationHistory = appendConversationMessage(historyWithUser, {
              role: 'assistant',
              content: assistantMessage,
              responseId: aiResult.responseId ?? undefined
            });
            pendingConfirmation = null;
            break;
          }

          process.stdout.write(`\n${indentBlock(aiResult.text)}\n\n`);
          pendingConfirmation = {
            type: 'ai-tool',
            pending: aiResult.pending,
            prompt: aiResult.text
          };
          break;
        }
        case 'ai-confirm': {
          const controller = createLineAILoopController(workspace);
          let aiResult: Awaited<ReturnType<typeof runAILoopSession>> & {wasStreamed: boolean};

          try {
            aiResult = await runLineAI(
              () => resumeAILoopAfterConfirmation(result.pending, result.approved, controller.options),
              controller
            );
          } catch (error: unknown) {
            process.stdout.write(
              `\n${indentBlock(error instanceof Error ? error.message : 'Unexpected error.')}\n\n`
            );
            pendingConfirmation = {
              type: 'ai-tool',
              pending: result.pending,
              prompt: result.pending.prompt
            };
            break;
          }

          if (aiResult.status === 'completed') {
            const assistantMessage = aiResult.text || 'No response.';
            if (!aiResult.wasStreamed) {
              process.stdout.write(`\n${indentBlock(assistantMessage)}\n\n`);
            } else {
              process.stdout.write('\n\n');
            }

            conversationHistory = appendConversationMessage(conversationHistory, {
              role: 'assistant',
              content: assistantMessage,
              responseId: aiResult.responseId ?? undefined
            });
            pendingConfirmation = null;
            break;
          }

          process.stdout.write(`\n${indentBlock(aiResult.text)}\n\n`);
          pendingConfirmation = {
            type: 'ai-tool',
            pending: aiResult.pending,
            prompt: aiResult.text
          };
          break;
        }
        default: {
          const shouldContinue = await writeLineReplResult(result);
          if (!shouldContinue) {
            return;
          }
        }
      }

      writePrompt(workspace);
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
    case 'confirm':
      process.stdout.write(`\n${indentBlock(result.message)}\n\n`);
      return true;
    case 'ai':
    case 'ai-confirm':
      return true;
    case 'exit':
      process.stdout.write(`\n  ${result.message}\n`);
      return false;
  }
}

function writeWorkspaceSummary(workspace: Workspace): void {
  process.stdout.write(`\n${indentBlock(formatWorkspaceSummary(workspace))}\n\n`);
}

function writePrompt(workspace: Workspace): void {
  process.stdout.write(`${chalk.dim(workspace.name)}${chalk.hex('#4ecdc4')(' > ')}`);
}

function indentBlock(content: string): string {
  return content
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

function formatWorkspaceSummary(workspace: Workspace): string {
  const lines = [`Workspace: ${workspace.name}`, `Path:      ${workspace.cwd}`];

  if (workspace.totalImages > 0) {
    lines.push(`Images:    ${workspace.totalImages} files found`);
    lines.push(`Labels:    ${workspace.labelFiles.length} annotation files found`);
  } else {
    lines.push('No images found in this directory.');
  }

  lines.push('──────────────────────────────────────');
  lines.push('Type help or / to see available commands.');

  return lines.join('\n');
}

function createLineAILoopController(workspace: Workspace): {
  options: AILoopOptions;
  getOutputBuffer: () => string;
  wasStreamed: () => boolean;
} {
  let outputStarted = false;
  let lastThinkingMessage: string | null = null;
  let outputBuffer = '';

  return {
    options: {
      workspace,
      onThinking: (message: string) => {
        if (lastThinkingMessage === message) {
          return;
        }

        lastThinkingMessage = message;
        process.stdout.write(`\n${indentBlock(message)}\n`);
      },
      onToolCall: () => {
        return;
      },
      onOutput: (text: string) => {
        outputBuffer += text;

        if (!outputStarted) {
          process.stdout.write('\n  ');
          outputStarted = true;
        }

        process.stdout.write(text.replace(/\n/g, '\n  '));
      }
    },
    getOutputBuffer: () => outputBuffer,
    wasStreamed: () => outputStarted
  };
}

async function runLineAI(
  run: () => ReturnType<typeof runAILoopSession> | ReturnType<typeof resumeAILoopAfterConfirmation>,
  controller: ReturnType<typeof createLineAILoopController>
): Promise<
  Awaited<ReturnType<typeof runAILoopSession>> & {
    wasStreamed: boolean;
  }
> {
  const result = await run();
  const outputBuffer = controller.getOutputBuffer();

  return {
    ...(result.status === 'completed' && !result.text && outputBuffer
      ? {...result, text: outputBuffer}
      : result),
    wasStreamed: controller.wasStreamed()
  };
}

function appendConversationMessage(
  history: ConversationMessage[],
  message: ConversationMessage
): ConversationMessage[] {
  return [...history, message].slice(-20);
}
