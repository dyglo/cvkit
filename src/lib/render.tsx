import process from 'node:process';
import React, {useEffect} from 'react';
import {Box, Text, render, useApp} from 'ink';

export async function renderOnce(node: React.ReactNode): Promise<void> {
  await new Promise<void>((resolve) => {
    const app = render(<ExitAfterPaint>{node}</ExitAfterPaint>, {
      stdout: process.stdout,
      stdin: process.stdin,
      patchConsole: false,
      exitOnCtrlC: true
    });

    void app.waitUntilExit().then(() => resolve());
  });
}

export async function renderInteractive(node: React.ReactNode): Promise<void> {
  await new Promise<void>((resolve) => {
    const app = render(node, {
      stdout: process.stdout,
      stdin: process.stdin,
      patchConsole: false,
      exitOnCtrlC: false
    });

    void app.waitUntilExit().then(() => resolve());
  });
}

export async function renderError(message: string): Promise<void> {
  await renderOnce(
    <Box paddingLeft={2}>
      <Text color="red">Error: {message}</Text>
    </Box>
  );
}

function ExitAfterPaint({children}: {children: React.ReactNode}): React.JSX.Element {
  const {exit} = useApp();

  useEffect(() => {
    exit();
  }, [exit]);

  return <>{children}</>;
}
