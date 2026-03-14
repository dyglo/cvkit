import type OpenAI from 'openai';
import type {
  Response,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseOutputItem
} from 'openai/resources/responses/responses.js';
import {PRIMARY_MODEL, getOpenAIClient} from '../lib/openai.js';
import type {Workspace} from '../lib/workspace.js';
import {buildSystemPrompt} from './system-prompt.js';
import {
  ALL_AI_TOOL_NAMES,
  describeAIToolCall,
  executeAITool,
  formatAIToolConfirmation,
  getToolSchemas,
  isAIToolName,
  isMutatingAITool,
  parseAIToolArguments,
  type AIToolArguments,
  type AIToolName
} from './tools.js';

const MAX_TOOL_ITERATIONS = 10;

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  responseId?: string;
}

export interface AILoopOptions {
  workspace: Workspace;
  onThinking: (message: string) => void;
  onToolCall: (tool: string, args: unknown) => void;
  onOutput: (text: string) => void;
  toolNames?: readonly AIToolName[];
}

export interface PendingAIToolCall {
  responseId: string;
  callId: string;
  toolName: AIToolName;
  args: AIToolArguments;
  prompt: string;
  nextIteration: number;
}

export type AILoopRunResult =
  | {
      status: 'completed';
      text: string;
      responseId: string | null;
    }
  | {
      status: 'confirmation_required';
      text: string;
      responseId: string;
      pending: PendingAIToolCall;
    };

export async function runAILoop(
  userInput: string,
  conversationHistory: ConversationMessage[],
  options: AILoopOptions
): Promise<string> {
  const result = await runAILoopSession(userInput, conversationHistory, options);
  return result.text;
}

export async function runAILoopSession(
  userInput: string,
  conversationHistory: ConversationMessage[],
  options: AILoopOptions
): Promise<AILoopRunResult> {
  options.onThinking('Thinking...');
  const previousResponseId = findLatestResponseId(conversationHistory);
  const input = buildInitialInput(userInput, conversationHistory, previousResponseId);

  return continueAILoop({
    client: await getOpenAIClient(),
    options,
    previousResponseId,
    input,
    iterationStart: 0
  });
}

export async function resumeAILoopAfterConfirmation(
  pending: PendingAIToolCall,
  approved: boolean,
  options: AILoopOptions
): Promise<AILoopRunResult> {
  options.onThinking('Thinking...');
  const client = await getOpenAIClient();
  let output: string;

  if (approved) {
    options.onThinking(describeAIToolCall(pending.toolName, pending.args));
    options.onToolCall(pending.toolName, pending.args);
    const result = await executeAITool(pending.toolName, pending.args, options.workspace);
    output = toFunctionCallOutput(result);
  } else {
    output = `User declined ${pending.toolName}.`;
  }

  return continueAILoop({
    client,
    options,
    previousResponseId: pending.responseId,
    input: [
      {
        type: 'function_call_output',
        call_id: pending.callId,
        output
      } satisfies ResponseInputItem.FunctionCallOutput
    ],
    iterationStart: pending.nextIteration
  });
}

async function continueAILoop({
  client,
  options,
  previousResponseId,
  input,
  iterationStart
}: {
  client: OpenAI;
  options: AILoopOptions;
  previousResponseId: string | null;
  input: string | ResponseInputItem[];
  iterationStart: number;
}): Promise<AILoopRunResult> {
  let currentPreviousResponseId = previousResponseId;
  let currentInput = input;
  const toolNames = options.toolNames ?? ALL_AI_TOOL_NAMES;
  const allowedTools = new Set<AIToolName>(toolNames);

  for (let iteration = iterationStart; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    options.onThinking(iteration === 0 ? 'Thinking...' : 'Preparing response...');
    const streamedChunks: string[] = [];
    const stream = client.responses.stream({
      model: PRIMARY_MODEL,
      instructions: buildSystemPrompt(options.workspace, toolNames),
      input: currentInput,
      previous_response_id: currentPreviousResponseId ?? undefined,
      parallel_tool_calls: false,
      store: true,
      tool_choice: 'auto',
      tools: getToolSchemas(toolNames) as unknown as OpenAI.Responses.ResponseCreateParams['tools']
    });

    stream.on('response.output_text.delta', (event) => {
      streamedChunks.push(event.delta);
      options.onOutput(event.delta);
    });

    const response = await stream.finalResponse();
    currentPreviousResponseId = response.id;

    const functionCall = findFunctionCall(response.output);
    if (!functionCall) {
      const text = streamedChunks.join('') || extractResponseText(response);
      if (!streamedChunks.length && text) {
        options.onOutput(text);
      }

      return {
        status: 'completed',
        text,
        responseId: response.id
      };
    }

    if (!isAIToolName(functionCall.name) || !allowedTools.has(functionCall.name)) {
      const message = `Model requested unavailable tool: ${functionCall.name}.`;
      options.onOutput(message);
      return {
        status: 'completed',
        text: message,
        responseId: response.id
      };
    }

    const parsedArgs = parseAIToolArguments(functionCall.name, functionCall.arguments);
    if (isMutatingAITool(functionCall.name)) {
      return {
        status: 'confirmation_required',
        text: formatAIToolConfirmation(functionCall.name, parsedArgs),
        responseId: response.id,
        pending: {
          responseId: response.id,
          callId: functionCall.call_id,
          toolName: functionCall.name,
          args: parsedArgs,
          prompt: formatAIToolConfirmation(functionCall.name, parsedArgs),
          nextIteration: iteration + 1
        }
      };
    }

    options.onThinking(describeAIToolCall(functionCall.name, parsedArgs));
    options.onToolCall(functionCall.name, parsedArgs);
    const toolResult = await executeAITool(functionCall.name, parsedArgs, options.workspace);
    currentInput = [
      {
        type: 'function_call_output',
        call_id: functionCall.call_id,
        output: toFunctionCallOutput(toolResult)
      } satisfies ResponseInputItem.FunctionCallOutput
    ];
  }

  const message = `AI loop stopped after ${MAX_TOOL_ITERATIONS} tool iterations.`;
  options.onOutput(message);
  return {
    status: 'completed',
    text: message,
    responseId: currentPreviousResponseId
  };
}

function findLatestResponseId(history: ConversationMessage[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const responseId = history[index]?.responseId;
    if (responseId) {
      return responseId;
    }
  }

  return null;
}

function buildInitialInput(
  userInput: string,
  conversationHistory: ConversationMessage[],
  previousResponseId: string | null
): string {
  if (previousResponseId) {
    return userInput;
  }

  if (conversationHistory.length === 0) {
    return userInput;
  }

  const transcript = conversationHistory
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n\n');

  return ['Recent conversation:', transcript, '', `Current request: ${userInput}`].join('\n');
}

function extractResponseText(response: Response): string {
  const chunks: string[] = [];

  for (const item of response.output) {
    if (item.type !== 'message') {
      continue;
    }

    for (const part of item.content) {
      if (part.type === 'output_text' && part.text) {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join('').trim();
}

function findFunctionCall(outputItems: ResponseOutputItem[]): ResponseFunctionToolCall | null {
  for (const item of outputItems) {
    if (item.type === 'function_call') {
      return item;
    }
  }

  return null;
}

function toFunctionCallOutput(result: {status: string; output: string; error?: string}): string {
  if (result.status === 'success') {
    return result.output;
  }

  return [`Tool status: ${result.status}`, result.error ?? result.output].join('\n');
}
