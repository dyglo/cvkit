import React, {useEffect, useRef, useState} from 'react';
import {Box, useApp, useInput} from 'ink';
import {InputBar} from './InputBar.js';
import {MessageList} from './MessageList.js';
import {StatusBar} from './StatusBar.js';
import {routeCommand} from './router.js';
import type {Message} from './types.js';

const MAX_MESSAGES = 50;
const MAX_HISTORY = 20;

export function Repl(): React.JSX.Element {
  const {exit} = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draftInput, setDraftInput] = useState('');
  const [exitMessage, setExitMessage] = useState<string | null>(null);
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
      : thinking
        ? appendMessage(messages, createMessage('thinking', ''))
        : messages;

  return (
    <Box flexDirection="column">
      <MessageList messages={visibleMessages} />
      {exitMessage === null ? (
        thinking ? (
          <Box marginTop={visibleMessages.length > 0 ? 1 : 0}>
            <StatusBar />
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={visibleMessages.length > 0 ? 1 : 0}>
            <InputBar value={input} onChange={handleInputChange} onSubmit={handleSubmit} />
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

    try {
      const result = await routeCommand(trimmed);

      switch (result.type) {
        case 'empty':
          break;
        case 'output':
          setMessages((current) => appendMessage(current, createMessage('output', result.message)));
          break;
        case 'error':
          setMessages((current) => appendMessage(current, createMessage('error', result.message)));
          break;
        case 'exit':
          triggerExit(result.message);
          return;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      setMessages((current) => appendMessage(current, createMessage('error', message)));
    } finally {
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
