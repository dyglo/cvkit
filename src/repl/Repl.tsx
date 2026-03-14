import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {
  resumeAILoopAfterConfirmation,
  runAILoopSession,
  type ConversationMessage
} from '../ai/loop.js';
import {InputBar} from './InputBar.js';
import {MessageList} from './MessageList.js';
import {StatusBar} from './StatusBar.js';
import {routeCommand} from './router.js';
import type {ConfirmationRequest, Message} from './types.js';
import type {Workspace} from '../lib/workspace.js';

const MAX_MESSAGES = 50;
const MAX_HISTORY = 20;
const MAX_CONVERSATION_MESSAGES = 20;
const SUMMARY_SEPARATOR = '──────────────────────────────────────';

export function Repl({workspace}: {workspace: Workspace}): React.JSX.Element {
  const {exit} = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [thinkingMessage, setThinkingMessage] = useState('Thinking...');
  const [streamedOutput, setStreamedOutput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draftInput, setDraftInput] = useState('');
  const [exitMessage, setExitMessage] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<ConfirmationRequest | null>(null);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const historyNavigationRef = useRef(false);

  useInput(
    (character, key) => {
      if (key.ctrl && character === 'c') {
        triggerExit('Goodbye.');
        return;
      }

      if (key.ctrl && character === 'l') {
        setMessages([]);
        return;
      }

      if (key.upArrow) {
        navigateHistory('up');
        return;
      }

      if (key.downArrow) {
        navigateHistory('down');
      }
    },
    {isActive: !thinking && exitMessage === null}
  );

  useEffect(() => {
    if (exitMessage === null) {
      return;
    }

    const timer = setTimeout(() => {
      exit();
    }, 10);

    return () => {
      clearTimeout(timer);
    };
  }, [exitMessage, exit]);

  const visibleMessages =
    exitMessage !== null
      ? appendMessage(messages, createMessage('output', exitMessage))
      : appendTransientMessages(messages, streamedOutput, thinking ? thinkingMessage : null);

  return (
    <Box flexDirection="column">
      <WorkspaceHeader workspace={workspace} />
      <Box marginTop={1}>
        <MessageList messages={visibleMessages} workspaceName={workspace.name} />
      </Box>
      {exitMessage === null ? (
        thinking ? (
          <Box marginTop={visibleMessages.length > 0 ? 1 : 0}>
            <StatusBar />
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={visibleMessages.length > 0 ? 1 : 0}>
            <InputBar
              workspaceName={workspace.name}
              value={input}
              onChange={handleInputChange}
              onSubmit={handleSubmit}
            />
            <StatusBar />
          </Box>
        )
      ) : null}
    </Box>
  );

  function handleInputChange(value: string): void {
    if (historyNavigationRef.current) {
      historyNavigationRef.current = false;
      setInput(value);
      return;
    }

    setHistoryIndex(null);
    setDraftInput(value);
    setInput(value);
  }

  async function handleSubmit(value: string): Promise<void> {
    if (thinking || exitMessage !== null) {
      return;
    }

    const submitted = value;
    setInput('');
    setHistoryIndex(null);
    setDraftInput('');

    const trimmed = submitted.trim();
    if (!trimmed) {
      return;
    }

    setMessages((current) => appendMessage(current, createMessage('input', trimmed)));
    setCommandHistory((current) => [...current, trimmed].slice(-MAX_HISTORY));
    setThinking(true);
    setThinkingMessage('Thinking...');
    setStreamedOutput('');

    try {
      const result = await routeCommand(trimmed, workspace, pendingConfirmation);

      switch (result.type) {
        case 'empty':
          setPendingConfirmation(null);
          break;
        case 'output':
          setPendingConfirmation(null);
          setMessages((current) => appendMessage(current, createMessage('output', result.message)));
          break;
        case 'error':
          setPendingConfirmation(null);
          setMessages((current) => appendMessage(current, createMessage('error', result.message)));
          break;
        case 'confirm':
          setPendingConfirmation(result.request);
          setMessages((current) => appendMessage(current, createMessage('output', result.message)));
          break;
        case 'ai': {
          const historyWithUser = appendConversationMessage(conversationHistory, {
            role: 'user',
            content: trimmed
          });
          setConversationHistory(historyWithUser);

          const aiResult = await executeAIRequest(async (outputBuffer) =>
            runAILoopSession(trimmed, conversationHistory, createAILoopOptions(outputBuffer))
          );

          if (aiResult.status === 'completed') {
            const assistantMessage = aiResult.text || 'No response.';
            setMessages((current) => appendMessage(current, createMessage('output', assistantMessage)));
            setConversationHistory(
              appendConversationMessage(historyWithUser, {
                role: 'assistant',
                content: assistantMessage,
                responseId: aiResult.responseId ?? undefined
              })
            );
            setPendingConfirmation(null);
            break;
          }

          setPendingConfirmation({
            type: 'ai-tool',
            pending: aiResult.pending,
            prompt: aiResult.text
          });
          setMessages((current) => appendMessage(current, createMessage('output', aiResult.text)));
          break;
        }
        case 'ai-confirm': {
          const aiResult = await executeAIRequest(async (outputBuffer) =>
            resumeAILoopAfterConfirmation(
              result.pending,
              result.approved,
              createAILoopOptions(outputBuffer)
            )
          );

          if (aiResult.status === 'completed') {
            const assistantMessage = aiResult.text || 'No response.';
            setMessages((current) => appendMessage(current, createMessage('output', assistantMessage)));
            setConversationHistory((current) =>
              appendConversationMessage(current, {
                role: 'assistant',
                content: assistantMessage,
                responseId: aiResult.responseId ?? undefined
              })
            );
            setPendingConfirmation(null);
            break;
          }

          setPendingConfirmation({
            type: 'ai-tool',
            pending: aiResult.pending,
            prompt: aiResult.text
          });
          setMessages((current) => appendMessage(current, createMessage('output', aiResult.text)));
          break;
        }
        case 'exit':
          setPendingConfirmation(null);
          triggerExit(result.message);
          return;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      setMessages((current) => appendMessage(current, createMessage('error', message)));
    } finally {
      setStreamedOutput('');
      setThinking(false);
    }
  }

  function navigateHistory(direction: 'up' | 'down'): void {
    if (commandHistory.length === 0) {
      return;
    }

    historyNavigationRef.current = true;

    if (direction === 'up') {
      if (historyIndex === null) {
        setDraftInput(input);
        const nextIndex = commandHistory.length - 1;
        setHistoryIndex(nextIndex);
        setInput(commandHistory[nextIndex]);
        return;
      }

      const nextIndex = Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInput(commandHistory[nextIndex]);
      return;
    }

    if (historyIndex === null) {
      return;
    }

    if (historyIndex >= commandHistory.length - 1) {
      setHistoryIndex(null);
      setInput(draftInput);
      return;
    }

    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    setInput(commandHistory[nextIndex]);
  }

  function triggerExit(message: string): void {
    setThinking(false);
    setExitMessage(message);
  }

  function createAILoopOptions(outputBuffer: {value: string}) {
    return {
      workspace,
      onThinking: (message: string) => {
        setThinkingMessage(message);
      },
      onToolCall: () => {
        return;
      },
      onOutput: (text: string) => {
        outputBuffer.value += text;
        setStreamedOutput((current) => `${current}${text}`);
      }
    };
  }

  async function executeAIRequest(
    run: (outputBuffer: {value: string}) => ReturnType<typeof runAILoopSession>
  ) {
    const outputBuffer = {value: ''};
    const result = await run(outputBuffer);
    if (result.status === 'completed' && !result.text && outputBuffer.value) {
      return {
        ...result,
        text: outputBuffer.value
      };
    }

    return result;
  }
}

function WorkspaceHeader({workspace}: {workspace: Workspace}): React.JSX.Element {
  const details =
    workspace.totalImages > 0
      ? [`Images:    ${workspace.totalImages} files found`, `Labels:    ${workspace.labelFiles.length} annotation files found`]
      : ['No images found in this directory.'];

  return (
    <Box flexDirection="column">
      <Text>{`  Workspace: ${workspace.name}`}</Text>
      <Text>{`  Path:      ${workspace.cwd}`}</Text>
      {details.map((line) => (
        <Text key={line}>{`  ${line}`}</Text>
      ))}
      <Text>{`  ${SUMMARY_SEPARATOR}`}</Text>
      <Text>  Type help or / to see available commands.</Text>
    </Box>
  );
}

function createMessage(role: Message['role'], content: string): Message {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content
  };
}

function appendMessage(messages: Message[], message: Message): Message[] {
  return [...messages, message].slice(-MAX_MESSAGES);
}

function appendTransientMessages(
  messages: Message[],
  streamedOutput: string,
  thinkingMessage: string | null
): Message[] {
  const visibleMessages = [...messages];

  if (streamedOutput) {
    visibleMessages.push({
      id: 'streamed-output',
      role: 'output',
      content: streamedOutput
    });
  }

  if (thinkingMessage) {
    visibleMessages.push({
      id: 'thinking-status',
      role: 'thinking',
      content: thinkingMessage
    });
  }

  return visibleMessages;
}

function appendConversationMessage(
  history: ConversationMessage[],
  message: ConversationMessage
): ConversationMessage[] {
  return [...history, message].slice(-MAX_CONVERSATION_MESSAGES);
}
