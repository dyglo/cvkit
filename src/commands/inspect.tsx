import React from 'react';
import {Box} from 'ink';
import {Command} from 'commander';
import {inspectImage, formatBytes} from '../lib/image.js';
import {renderOnce} from '../lib/render.js';
import {Table} from '../ui/Table.js';

export function registerInspect(program: Command): void {
  program
    .command('inspect')
    .description('Inspect image metadata')
    .argument('<imagePath>', 'Image path')
    .action(async (imagePath: string) => {
      const metadata = await inspectImage(imagePath);
      await renderOnce(
        <Box flexDirection="column">
          <Table
            rows={[
              {label: 'File', value: metadata.fileName},
              {label: 'Format', value: metadata.format},
              {label: 'Dimensions', value: `${metadata.width} × ${metadata.height}`},
              {label: 'Channels', value: `${metadata.channels} (${metadata.channelLabel})`},
              {label: 'Color mode', value: metadata.colorMode},
              {label: 'File size', value: formatBytes(metadata.fileSizeBytes)},
              {label: 'Has alpha', value: metadata.hasAlpha ? 'Yes' : 'No'},
              {label: 'Bit depth', value: metadata.bitDepth}
            ]}
          />
        </Box>
      );
    });
}
