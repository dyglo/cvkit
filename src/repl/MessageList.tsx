import React from 'react';
import {Box, Text} from 'ink';
import chalk from 'chalk';
import {Message} from './Message.js';
import type {Message as ReplMessage} from './types.js';

const separator = chalk.dim('──────────────');

export function MessageList({
  messages,
  workspaceName
}: {
  messages: ReplMessage[];
  workspaceName: string;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {messages.map((message, index) => (
        <Box key={message.id} flexDirection="column">
          {index > 0 && message.role === 'input' ? <Text>{separator}</Text> : null}
          <Message message={message} workspaceName={workspaceName} />
        </Box>
      ))}
    </Box>
  );
}
