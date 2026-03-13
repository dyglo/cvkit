import process from 'node:process';
import path from 'node:path';
import React, {useEffect, useState} from 'react';
import {Box, Text, useApp} from 'ink';
import {Spinner} from '@inkjs/ui';
import {Command} from 'commander';
import {formatPairLabel, parseConvertFormat} from '../lib/convert.js';
import {PythonWorkerError, runPythonWorker} from '../lib/python.js';
import {renderInteractive, renderOnce} from '../lib/render.js';
import type {ConvertFormat, ConvertWorkerErrorPayload, ConvertWorkerResult} from '../types/index.js';
import {Table} from '../ui/Table.js';

type ConvertOptions = {
  from: string;
  to: string;
  output: string;
  classes?: string;
  dryRun?: boolean;
};

type ConvertScreenState = {
  loading: boolean;
  startedAt: number;
  result?: ConvertWorkerResult;
  error?: string;
  partial?: ConvertWorkerErrorPayload;
};

export function registerConvert(program: Command): void {
  program
    .command('convert')
    .description('Convert dataset annotations between supported formats')
    .argument('<dir>', 'Dataset directory')
    .requiredOption('--from <format>', 'Source format (yolo|coco|pascal-voc|labelme|cvat)')
    .requiredOption('--to <format>', 'Target format (yolo|coco|pascal-voc|labelme|cvat)')
    .option('--output <dir>', 'Output directory', './converted')
    .option('--classes <path>', 'Path to classes.txt or data.yaml')
    .option('--dry-run', 'Show what would be converted without writing files', false)
    .action(async (dir: string, options: ConvertOptions) => {
      const fromFormat = parseConvertFormat(options.from);
      const toFormat = parseConvertFormat(options.to);

      if (fromFormat === toFormat) {
        await renderOnce(
          <Box paddingLeft={2}>
            <Text color="yellow">{`Warning: ${fromFormat} is already the source format. No conversion performed.`}</Text>
          </Box>
        );
        return;
      }

      await renderInteractive(
        <ConvertScreen
          classes={options.classes}
          dir={dir}
          dryRun={Boolean(options.dryRun)}
          fromFormat={fromFormat}
          output={options.output}
          toFormat={toFormat}
        />
      );
    });
}

function ConvertScreen({
  classes,
  dir,
  dryRun,
  fromFormat,
  output,
  toFormat
}: {
  classes?: string;
  dir: string;
  dryRun: boolean;
  fromFormat: ConvertFormat;
  output: string;
  toFormat: ConvertFormat;
}): React.JSX.Element {
  const {exit} = useApp();
  const [state, setState] = useState<ConvertScreenState>({
    loading: true,
    startedAt: Date.now()
  });

  useEffect(() => {
    void (async () => {
      try {
        const args = [
          '--dir',
          path.resolve(dir),
          '--from-format',
          fromFormat,
          '--to-format',
          toFormat,
          '--output',
          output
        ];

        if (classes) {
          args.push('--classes', path.resolve(classes));
        }

        if (dryRun) {
          args.push('--dry-run');
        }

        const result = await runPythonWorker<ConvertWorkerResult>('convert_worker.py', args);
        setState((current) => ({
          ...current,
          loading: false,
          result
        }));
      } catch (error: unknown) {
        process.exitCode = 1;
        setState((current) => ({
          ...current,
          loading: false,
          error: formatError(error),
          partial: parseWorkerErrorPayload(error)
        }));
      }
    })();
  }, [classes, dir, dryRun, fromFormat, output, toFormat]);

  useEffect(() => {
    if (!state.loading) {
      setTimeout(exit, 0);
    }
  }, [exit, state.loading]);

  if (state.loading) {
    return (
      <Box paddingLeft={2}>
        <Spinner label="Converting annotations..." />
      </Box>
    );
  }

  if (state.error) {
    return <ConvertErrorView dir={dir} error={state.error} fromFormat={fromFormat} partial={state.partial} toFormat={toFormat} />;
  }

  const result = state.result!;
  const elapsed = Date.now() - state.startedAt;

  if (result.dry_run) {
    return <ConvertDryRunView dir={dir} elapsed={elapsed} fromFormat={fromFormat} result={result} toFormat={toFormat} />;
  }

  return <ConvertSuccessView dir={dir} elapsed={elapsed} fromFormat={fromFormat} result={result} toFormat={toFormat} />;
}

function ConvertSuccessView({
  dir,
  elapsed,
  fromFormat,
  result,
  toFormat
}: {
  dir: string;
  elapsed: number;
  fromFormat: ConvertFormat;
  result: ConvertWorkerResult;
  toFormat: ConvertFormat;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        <Text>{`Converting: ${dir}`}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text>{formatPairLabel(fromFormat, toFormat)}</Text>
      </Box>
      <Divider />
      <Table
        rows={[
          {label: 'Images processed', value: result.images_processed.toLocaleString()},
          {label: 'Annotations converted', value: result.annotations_converted.toLocaleString()},
          {label: `Classes (${result.classes.length})`, value: formatClasses(result.classes)},
          {label: 'Output', value: ensureTrailingSlash(result.output_dir)}
        ]}
      />
      {result.warnings.length > 0 && (
        <>
          <Box paddingLeft={2} marginTop={1}>
            <Text>Warnings:</Text>
          </Box>
          {result.warnings.map((warning) => (
            <Box key={warning} paddingLeft={4}>
              <Text>{warning}</Text>
            </Box>
          ))}
        </>
      )}
      <Divider />
      <Box paddingLeft={2}>
        <Text>{`Done in ${formatDuration(elapsed)}`}</Text>
      </Box>
    </Box>
  );
}

function ConvertDryRunView({
  dir,
  elapsed,
  fromFormat,
  result,
  toFormat
}: {
  dir: string;
  elapsed: number;
  fromFormat: ConvertFormat;
  result: ConvertWorkerResult;
  toFormat: ConvertFormat;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        <Text color="yellow">Dry run — no files will be written</Text>
      </Box>
      <Box paddingLeft={2} marginTop={1}>
        <Text>{`Would convert: ${dir}`}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text>{formatPairLabel(fromFormat, toFormat)}</Text>
      </Box>
      <Divider />
      <Table
        rows={[
          {label: 'Images found', value: result.images_processed.toLocaleString()},
          {label: 'Annotations found', value: result.annotations_converted.toLocaleString()},
          {label: `Classes detected (${result.classes.length})`, value: formatClasses(result.classes)},
          {label: 'Output would be', value: ensureTrailingSlash(result.output_dir)}
        ]}
      />
      {result.warnings.length > 0 && (
        <>
          <Box paddingLeft={2} marginTop={1}>
            <Text>Warnings:</Text>
          </Box>
          {result.warnings.map((warning) => (
            <Box key={warning} paddingLeft={4}>
              <Text>{warning}</Text>
            </Box>
          ))}
        </>
      )}
      <Divider />
      <Box paddingLeft={2}>
        <Text>{`Run without --dry-run to apply conversion (${formatDuration(elapsed)})`}</Text>
      </Box>
    </Box>
  );
}

function ConvertErrorView({
  dir,
  error,
  fromFormat,
  partial,
  toFormat
}: {
  dir: string;
  error: string;
  fromFormat: ConvertFormat;
  partial?: ConvertWorkerErrorPayload;
  toFormat: ConvertFormat;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        <Text>{`Converting: ${dir}`}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text>{formatPairLabel(fromFormat, toFormat)}</Text>
      </Box>
      <Divider />
      {partial && typeof partial.images_processed === 'number' && typeof partial.annotations_converted === 'number' && (
        <Table
          rows={[
            {label: 'Images processed', value: partial.images_processed.toLocaleString()},
            {label: 'Annotations converted', value: partial.annotations_converted.toLocaleString()},
            {label: `Classes (${partial.classes?.length ?? 0})`, value: formatClasses(partial.classes ?? [])},
            {label: 'Output', value: ensureTrailingSlash(partial.output_dir ?? './converted')}
          ]}
        />
      )}
      <Box paddingLeft={2}>
        <Text color="red">{`Error: ${partial?.error ?? error}`}</Text>
      </Box>
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

function formatError(error: unknown): string {
  if (error instanceof PythonWorkerError) {
    const parsed = parseWorkerErrorPayload(error);
    return parsed?.error ?? error.message;
  }

  return error instanceof Error ? error.message : 'Unexpected error.';
}

function parseWorkerErrorPayload(error: unknown): ConvertWorkerErrorPayload | undefined {
  if (!(error instanceof PythonWorkerError)) {
    return undefined;
  }

  const raw = error.stderr.trim();
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as ConvertWorkerErrorPayload;
    if (typeof parsed.error === 'string') {
      return parsed;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function formatClasses(classes: string[]): string {
  return classes.length > 0 ? classes.join(', ') : 'None detected';
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') || value.endsWith('\\') ? value : `${value}${path.sep}`;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}
