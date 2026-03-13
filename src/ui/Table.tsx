import React from 'react';
import {Box, Text} from 'ink';

type TableRow = {
  label: string;
  value: string;
};

export function Table({rows, indent = 2}: {rows: TableRow[]; indent?: number}): React.JSX.Element {
  const width = rows.reduce((max, row) => Math.max(max, row.label.length), 0);

  return (
    <Box flexDirection="column" paddingLeft={indent}>
      {rows.map((row) => (
        <Box key={`${row.label}:${row.value}`}>
          <Text>{row.label.padEnd(width + 2)}</Text>
          <Text>{row.value}</Text>
        </Box>
      ))}
    </Box>
  );
}
