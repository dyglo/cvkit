import React from 'react';
import {Box, Text} from 'ink';

export function StatusLine({text}: {text: string}): React.JSX.Element {
  return (
    <Box paddingLeft={2} marginTop={1}>
      <Text color="gray">{text}</Text>
    </Box>
  );
}
