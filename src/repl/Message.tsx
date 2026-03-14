import React from 'react';
import {Box, Text} from 'ink';
import chalk from 'chalk';
import {Spinner} from './Spinner.js';
import type {Message as ReplMessage} from './types.js';

const teal = chalk.hex('#4ecdc4');

export function Message({message}: {message: ReplMessage}): React.JSX.Element {
  switch (message.role) {
    case 'input':
      return (
        <Box>
          <Text>{teal('> ')}</Text>
          <Text>{message.content}</Text>
        </Box>
      );
    case 'error':
      return (
        <Box flexDirection="column" paddingLeft={2}>
          {splitLines(message.content).map((line, index) => (
            <Text key={`${message.id}:${index}`} color="red">
              {line}
            </Text>
          ))}
        </Box>
      );
    case 'thinking':
      return (
        <Box paddingLeft={2}>
          <Spinner />
        </Box>
      );
    case 'output':
    default:
      return (
        <Box flexDirection="column" paddingLeft={2}>
          {splitLines(message.content).map((line, index) => (
            <Text key={`${message.id}:${index}`}>{line}</Text>
          ))}
        </Box>
      );
  }
}

function splitLines(content: string): string[] {
  return content.split('\n');
}
