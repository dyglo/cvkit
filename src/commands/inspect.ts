import {Command} from 'commander';
import {inspectImage} from '../lib/inspect-image.js';
import {formatInspectionReport} from '../lib/output.js';

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect')
    .description('Inspect image metadata')
    .argument('<image>', 'Path to the image file')
    .action(async (imagePath: string) => {
      const report = await inspectImage(imagePath);
      process.stdout.write(`${formatInspectionReport(report)}\n`);
    });
}

