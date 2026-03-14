import {FunctionCallingConfigMode} from '@google/genai';
import {getClient, TEXT_MODEL, type AIClient, type AIContent, type AIResponse} from '../lib/ai-client.js';
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
  responseId: string | null;
  callId: string;
  toolName: AIToolName;
  args: AIToolArguments;
  prompt: string;
  nextIteration: number;
  contents: AIContent[];
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
      responseId: string | null;
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

  return continueAILoop({
    client: await getClient(),
    options,
    contents: buildInitialContents(userInput, conversationHistory),
    iterationStart: 0
  });
}

export async function resumeAILoopAfterConfirmation(
  pending: PendingAIToolCall,
  approved: boolean,
  options: AILoopOptions
): Promise<AILoopRunResult> {
  options.onThinking('Thinking...');
  const client = await getClient();
  const currentContents = [...pending.contents];

  let output: string;
  if (approved) {
    options.onThinking(describeAIToolCall(pending.toolName, pending.args));
    options.onToolCall(pending.toolName, pending.args);
    const result = await executeAITool(pending.toolName, pending.args, options.workspace);
    output = toFunctionCallOutput(result);
  } else {
    output = `User declined ${pending.toolName}.`;
  }

  currentContents.push(createFunctionResponseContent(pending.callId, pending.toolName, {output}));

  return continueAILoop({
    client,
    options,
    contents: currentContents,
    iterationStart: pending.nextIteration
  });
}

async function continueAILoop({
  client,
  options,
  contents,
  iterationStart
}: {
  client: AIClient;
  options: AILoopOptions;
  contents: AIContent[];
  iterationStart: number;
}): Promise<AILoopRunResult> {
  let currentContents = [...contents];
  const toolNames = options.toolNames ?? ALL_AI_TOOL_NAMES;
  const allowedTools = new Set<AIToolName>(toolNames);

  for (let iteration = iterationStart; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    options.onThinking(iteration === 0 ? 'Thinking...' : 'Preparing response...');
    const response = await client.models.generateContent({
      model: TEXT_MODEL,
      contents: currentContents,
      config: {
        systemInstruction: buildSystemPrompt(options.workspace, toolNames),
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.VALIDATED,
            allowedFunctionNames: [...allowedTools]
          }
        },
        tools: [
          {
            functionDeclarations: getToolSchemas(toolNames).map((schema) => ({
              name: schema.name,
              description: schema.description,
              parametersJsonSchema: schema.parameters
            }))
          }
        ]
      }
    });

    const functionCall = findFunctionCall(response);
    if (!functionCall) {
      const text = extractResponseText(response);
      if (text) {
        options.onOutput(text);
      }

      return {
        status: 'completed',
        text,
        responseId: null
      };
    }

    if (!functionCall.name || !isAIToolName(functionCall.name) || !allowedTools.has(functionCall.name)) {
      const message = `Model requested unavailable tool: ${functionCall.name ?? 'unknown'}.`;
      options.onOutput(message);
      return {
        status: 'completed',
        text: message,
        responseId: null
      };
    }

    const parsedArgs = parseAIToolArguments(functionCall.name, JSON.stringify(functionCall.args ?? {}));
    currentContents = [...currentContents, createModelResponseContent(response, functionCall)];

    if (isMutatingAITool(functionCall.name)) {
      return {
        status: 'confirmation_required',
        text: formatAIToolConfirmation(functionCall.name, parsedArgs),
        responseId: null,
        pending: {
          responseId: null,
          callId: functionCall.callId,
          toolName: functionCall.name,
          args: parsedArgs,
          prompt: formatAIToolConfirmation(functionCall.name, parsedArgs),
          nextIteration: iteration + 1,
          contents: currentContents
        }
      };
    }

    options.onThinking(describeAIToolCall(functionCall.name, parsedArgs));
    options.onToolCall(functionCall.name, parsedArgs);
    const toolResult = await executeAITool(functionCall.name, parsedArgs, options.workspace);
    currentContents.push(
      createFunctionResponseContent(functionCall.callId, functionCall.name, {
        output: toFunctionCallOutput(toolResult)
      })
    );
  }

  const message = `AI loop stopped after ${MAX_TOOL_ITERATIONS} tool iterations.`;
  options.onOutput(message);
  return {
    status: 'completed',
    text: message,
    responseId: null
  };
}

function buildInitialContents(
  userInput: string,
  conversationHistory: ConversationMessage[]
): AIContent[] {
  const contents = conversationHistory.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{text: message.content}]
  })) satisfies AIContent[];

  contents.push({
    role: 'user',
    parts: [{text: userInput}]
  });

  return contents;
}

function extractResponseText(response: AIResponse): string {
  return response.text?.trim() ?? '';
}

function findFunctionCall(
  response: AIResponse
): {callId: string; name: string; args: Record<string, unknown>} | null {
  const functionCall = response.functionCalls?.[0];
  if (!functionCall?.name) {
    return null;
  }

  return {
    callId: functionCall.id ?? `${functionCall.name}-call`,
    name: functionCall.name,
    args: functionCall.args ?? {}
  };
}

function createModelResponseContent(
  response: AIResponse,
  functionCall: {callId: string; name: string; args: Record<string, unknown>}
): AIContent {
  const parts = response.candidates?.[0]?.content?.parts;
  if (parts && parts.length > 0) {
    return {
      role: 'model',
      parts
    };
  }

  return {
    role: 'model',
    parts: [
      {
        functionCall: {
          id: functionCall.callId,
          name: functionCall.name,
          args: functionCall.args
        }
      }
    ]
  };
}

function createFunctionResponseContent(
  callId: string,
  name: string,
  response: Record<string, unknown>
): AIContent {
  return {
    role: 'user',
    parts: [
      {
        functionResponse: {
          id: callId,
          name,
          response
        }
      }
    ]
  };
}

function toFunctionCallOutput(result: {status: string; output: string; error?: string}): string {
  if (result.status === 'success') {
    return result.output;
  }

  return [`Tool status: ${result.status}`, result.error ?? result.output].join('\n');
}
