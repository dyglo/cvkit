import React from 'react';
import {Box, Text} from 'ink';
import TextInput from 'ink-text-input';
import chalk from 'chalk';

const teal = chalk.hex('#4ecdc4');

export function InputBar({
  value,
  onChange,
  onSubmit
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}): React.JSX.Element {
  return (
    <Box>
      <Text>{teal('> ')}</Text>
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
    </Box>
  );
}
