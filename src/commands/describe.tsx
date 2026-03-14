import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import React, {useEffect, useState} from 'react';
import {Spinner} from '@inkjs/ui';
import {Box, Text, useApp} from 'ink';
import {Command} from 'commander';
import {renderInteractive, renderOnce} from '../lib/render.js';
import {callStructuredVision, listVisionImages} from '../lib/vision.js';

type DescribeOptions = {
  output?: string;
};

type DescribePayload = {
  description: string;
  objects: string[];
  suggested_tasks: string[];
  quality_notes: string[];
};

type DescribeResult = {
  fileName: string;
  description: string;
  objects: string[];
  suggestedTasks: string[];
  qualityNotes: string[];
  model: string;
  tokensUsed: number;
};

type DescribeCsvRow = {
  filename: string;
  description: string;
  objects: string;
  suggested_tasks: string;
  quality_notes: string;
};

type BatchDescribeProgress = {
  current: number;
  total: number;
  fileName: string;
};

type BatchDescribeResult = {
  outputPath: string;
  total: number;
  failed: number;
};

type DescribeBatchState = {
  loading: boolean;
  progress?: BatchDescribeProgress;
  result?: BatchDescribeResult;
  error?: string;
};

const DESCRIBE_PROMPT = [
  'You are a computer vision assistant.',
  'Analyze this image and return strict JSON only.',
  'JSON schema:',
  '{',
  '  "description": "2-3 concise technical sentences",',
  '  "objects": ["object 1", "object 2"],',
  '  "suggested_tasks": ["task 1", "task 2"],',
  '  "quality_notes": ["note 1", "note 2"]',
  '}',
  'Focus on visible content, CV relevance, and data quality.'
] as const;

export function registerDescribe(program: Command): void {
  program
    .command('describe')
    .description('Describe an image or a directory of images')
    .argument('<imagePathOrDir>', 'Image path or directory')
    .option('--output <path>', 'CSV output path for directory mode')
    .action(async (imagePathOrDir: string, options: DescribeOptions) => {
      const resolvedPath = path.resolve(imagePathOrDir);
      const stats = await import('node:fs/promises').then((fs) => fs.stat(resolvedPath)).catch((error: unknown) => {
        if (isErrno(error, 'ENOENT')) {
          throw new Error(`Path not found: ${imagePathOrDir}`);
        }

        throw error;
      });

      if (stats.isDirectory()) {
        await renderInteractive(<DescribeBatchScreen dir={imagePathOrDir} outputPath={options.output} />);
        return;
      }

      const result = await describeImage(imagePathOrDir);
      await renderOnce(<DescribeSingleView result={result} />);
    });
}

export async function describeImage(imagePath: string): Promise<DescribeResult> {
  const response = await callStructuredVision<DescribePayload>({
    imagePath,
    prompt: DESCRIBE_PROMPT.join('\n'),
    maxTokens: 1000
  });

  return {
    fileName: path.basename(imagePath),
    description: String(response.data.description ?? '').trim(),
    objects: sanitizeList(response.data.objects),
    suggestedTasks: sanitizeList(response.data.suggested_tasks),
    qualityNotes: sanitizeList(response.data.quality_notes),
    model: response.model,
    tokensUsed: response.tokensUsed
  };
}

export async function describeDirectory(
  dirPath: string,
  outputPath?: string,
  onProgress?: (progress: BatchDescribeProgress) => void
): Promise<BatchDescribeResult> {
  const images = await listVisionImages(dirPath);
  const resolvedOutputPath = path.resolve(outputPath ?? `cvkit-describe-${createTimestamp()}.csv`);
  const rows: DescribeCsvRow[] = [];
  let failed = 0;

  for (const [index, imagePath] of images.entries()) {
    onProgress?.({
      current: index + 1,
      total: images.length,
      fileName: path.basename(imagePath)
    });

    try {
      const result = await describeImage(imagePath);
      rows.push({
        filename: result.fileName,
        description: result.description,
        objects: result.objects.join('; '),
        suggested_tasks: result.suggestedTasks.join('; '),
        quality_notes: result.qualityNotes.join('; ')
      });
    } catch (error: unknown) {
      failed += 1;
      rows.push({
        filename: path.basename(imagePath),
        description: '',
        objects: '',
        suggested_tasks: '',
        quality_notes: `ERROR: ${formatMessage(error)}`
      });
    }
  }

  await mkdir(path.dirname(resolvedOutputPath), {recursive: true});
  await writeFile(resolvedOutputPath, buildDescribeCsv(rows), 'utf8');

  return {
    outputPath: resolvedOutputPath,
    total: images.length,
    failed
  };
}

function DescribeSingleView({result}: {result: DescribeResult}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        <Text>{`Describing: ${result.fileName}`}</Text>
      </Box>
      <Divider />
      <Section title="Description" lines={splitParagraph(result.description)} />
      <Section title="Objects detected" lines={toBulletLines(result.objects)} />
      <Section title="Suggested CV tasks" lines={toBulletLines(result.suggestedTasks)} />
      <Section title="Quality notes" lines={toBulletLines(result.qualityNotes)} />
      <Divider />
      <Box paddingLeft={2}>
        <Text>{`Model: ${result.model}  |  Tokens used: ${result.tokensUsed}`}</Text>
      </Box>
    </Box>
  );
}

function DescribeBatchScreen({dir, outputPath}: {dir: string; outputPath?: string}): React.JSX.Element {
  const {exit} = useApp();
  const [state, setState] = useState<DescribeBatchState>({
    loading: true
  });

  useEffect(() => {
    void (async () => {
      try {
        const result = await describeDirectory(dir, outputPath, (progress) => {
          setState((current) => ({
            ...current,
            progress
          }));
        });

        if (result.failed > 0) {
          process.exitCode = 1;
        }

        setState({
          loading: false,
          result
        });
      } catch (error: unknown) {
        process.exitCode = 1;
        setState({
          loading: false,
          error: formatMessage(error)
        });
      }
    })();
  }, [dir, outputPath]);

  useEffect(() => {
    if (!state.loading) {
      setTimeout(exit, 0);
    }
  }, [exit, state.loading]);

  if (state.loading) {
    const progress = state.progress;
    const label = progress
      ? `Describing image ${progress.current}/${progress.total}... ${progress.fileName}`
      : 'Preparing batch describe...';

    return (
      <Box paddingLeft={2}>
        <Spinner label={label} />
      </Box>
    );
  }

  if (state.error) {
    return (
      <Box paddingLeft={2}>
        <Text color="red">{`Error: ${state.error}`}</Text>
      </Box>
    );
  }

  const result = state.result!;

  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        <Text>{`Described ${result.total} image${result.total === 1 ? '' : 's'} from ${dir}`}</Text>
      </Box>
      <Divider />
      <Box paddingLeft={2}>
        <Text>{`CSV: ${result.outputPath}`}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text>{`Failures: ${result.failed}`}</Text>
      </Box>
    </Box>
  );
}

function Section({title, lines}: {title: string; lines: string[]}): React.JSX.Element {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box paddingLeft={2}>
        <Text>{title}</Text>
      </Box>
      {lines.length > 0 ? (
        lines.map((line) => (
          <Box key={`${title}:${line}`} paddingLeft={4}>
            <Text>{line}</Text>
          </Box>
        ))
      ) : (
        <Box paddingLeft={4}>
          <Text>None</Text>
        </Box>
      )}
    </Box>
  );
}

function Divider(): React.JSX.Element {
  return (
    <Box paddingLeft={2}>
      <Text>─────────────────────────────────────────</Text>
    </Box>
  );
}

function splitParagraph(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function toBulletLines(values: string[]): string[] {
  return values.map((value) => `- ${value}`);
}

function sanitizeList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function buildDescribeCsv(rows: DescribeCsvRow[]): string {
  const header = ['filename', 'description', 'objects', 'suggested_tasks', 'quality_notes'];
  const data = rows.map((row) => [
    row.filename,
    row.description,
    row.objects,
    row.suggested_tasks,
    row.quality_notes
  ]);

  return [header, ...data].map((columns) => columns.map(escapeCsvCell).join(',')).join('\n').concat('\n');
}

function escapeCsvCell(value: string): string {
  const escaped = value.replaceAll('"', '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function createTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function formatMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error.';
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
