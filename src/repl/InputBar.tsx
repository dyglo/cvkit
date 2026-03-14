import React from 'react';
import {Box, Text} from 'ink';
import TextInput from 'ink-text-input';
import chalk from 'chalk';

const teal = chalk.hex('#4ecdc4');

export function InputBar({
  workspaceName,
  value,
  onChange,
  onSubmit
}: {
  workspaceName: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}): React.JSX.Element {
  return (
    <Box>
      <Text color="gray">{workspaceName}</Text>
      <Text>{teal(' > ')}</Text>
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
    </Box>
  );
}
