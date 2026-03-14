import React from 'react';
import {Box, Text} from 'ink';

export function StatusBar(): React.JSX.Element {
  return (
    <Box paddingLeft={2} marginTop={1}>
      <Text color="gray">? for help   ctrl+c to exit</Text>
    </Box>
  );
}
