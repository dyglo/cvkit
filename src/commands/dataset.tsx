import path from 'node:path';
import React, {useEffect, useState} from 'react';
import {Box, Text, useApp} from 'ink';
import {Select, Spinner} from '@inkjs/ui';
import {Command} from 'commander';
import {
  assertDirectoryExists,
  deleteDuplicateArtifacts,
  detectAnnotationFormat,
  formatBytes,
  formatPercent,
  inspectDataset,
  renderBar,
  splitDataset,
  validateDataset
} from '../lib/dataset.js';
import {runPythonWorker} from '../lib/python.js';
import {renderInteractive} from '../lib/render.js';
import type {
  AnnotationFormat,
  DatasetInspectResult,
  DupesWorkerResult,
  SplitResult,
  StatsWorkerResult,
  ValidationResult
} from '../types/index.js';
import {StatusLine} from '../ui/StatusLine.js';
import {Table} from '../ui/Table.js';

export function registerDataset(program: Command): void {
  const dataset = program.command('dataset').description('Dataset intelligence commands');

  dataset
    .command('inspect')
    .description('Inspect dataset metadata')
    .argument('<dir>', 'Dataset directory')
    .action(async (dir: string) => {
      await renderInteractive(<DatasetInspectScreen dir={dir} />);
    });

  dataset
    .command('validate')
    .description('Validate dataset annotations')
    .argument('<dir>', 'Dataset directory')
    .option('--format <format>', 'Annotation format (yolo|coco|pascal-voc)')
    .option('--fix', 'Attempt safe YOLO fixes', false)
    .action(async (dir: string, options: {format?: string; fix?: boolean}) => {
      const format = await normalizeFormat(dir, options.format);
      await renderInteractive(<DatasetValidateScreen dir={dir} format={format} fix={Boolean(options.fix)} />);
    });

  dataset
    .command('split')
    .description('Split dataset into train/val/test')
    .argument('<dir>', 'Dataset directory')
    .option('--train <n>', 'Train percentage', '70')
    .option('--val <n>', 'Validation percentage', '20')
    .option('--test <n>', 'Test percentage', '10')
    .option('--output <dir>', 'Output directory', './split')
    .option('--seed <n>', 'Seed', '42')
    .option('--format <format>', 'Annotation format (yolo|coco|pascal-voc)')
    .action(
      async (
        dir: string,
        options: {
          train: string;
          val: string;
          test: string;
          output: string;
          seed: string;
          format?: string;
        }
      ) => {
        const format = await normalizeFormat(dir, options.format);
        await renderInteractive(
          <DatasetSplitScreen
            dir={dir}
            format={format}
            output={options.output}
            seed={Number(options.seed)}
            train={Number(options.train)}
            val={Number(options.val)}
            test={Number(options.test)}
          />
        );
      }
    );

  dataset
    .command('dupes')
    .description('Find duplicate images')
    .argument('<dir>', 'Dataset directory')
    .option('--threshold <n>', 'Hamming distance threshold', '10')
    .option('--delete', 'Delete duplicates interactively', false)
    .action(async (dir: string, options: {threshold: string; delete?: boolean}) => {
      await renderInteractive(
        <DatasetDupesScreen dir={dir} threshold={Number(options.threshold)} deleteMode={Boolean(options.delete)} />
      );
    });

  dataset
    .command('stats')
    .description('Compute dataset statistics')
    .argument('<dir>', 'Dataset directory')
    .action(async (dir: string) => {
      await renderInteractive(<DatasetStatsScreen dir={dir} />);
    });
}

function DatasetInspectScreen({dir}: {dir: string}): React.JSX.Element {
  const {exit} = useApp();
  const [state, setState] = useState<{loading: boolean; result?: DatasetInspectResult; error?: string}>({
    loading: true
  });

  useEffect(() => {
    void (async () => {
      try {
        const result = await inspectDataset(dir);
        setState({loading: false, result});
      } catch (error: unknown) {
        setState({loading: false, error: formatError(error)});
      }
    })();
  }, [dir]);

  useEffect(() => {
    if (!state.loading) {
      setTimeout(exit, 0);
    }
  }, [exit, state.loading]);

  if (state.loading) {
    return (
      <Box paddingLeft={2}>
        <Spinner label={`Scanning dataset: ${dir}`} />
      </Box>
    );
  }

  if (state.error) {
    return <ErrorView message={state.error} />;
  }

  const result = state.result!;
  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        <Text>{`Dataset: ${result.datasetPath}`}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text>───────────────────────────────────────</Text>
      </Box>
      <Table
        rows={[
          {label: 'Images', value: result.imageCount.toLocaleString()},
          {
            label: 'Annotated',
            value: `${result.annotatedCount.toLocaleString()} (${formatPercent(
              result.annotatedCount,
              result.imageCount
            )})`
          },
          {label: 'Unannotated', value: result.unannotatedCount.toLocaleString()}
        ]}
      />
      <Box paddingLeft={2} marginTop={1}>
        <Text>Formats</Text>
      </Box>
      <Table rows={result.formatBreakdown.map((entry) => ({label: entry.label, value: entry.count.toLocaleString()}))} indent={4} />
      <Table
        rows={[
          {
            label: 'Annotation format',
            value: result.annotationFormat ? result.annotationFormat.toUpperCase() : 'None detected'
          }
        ]}
      />
      {result.classBreakdown.length > 0 && (
        <>
          <Box paddingLeft={2}>
            <Text>{`Classes (${result.classBreakdown.length})`}</Text>
          </Box>
          <Table
            rows={result.classBreakdown.map((entry) => ({
              label: `${entry.id}: ${entry.name}`,
              value: `${entry.imageCount} images`
            }))}
            indent={4}
          />
        </>
      )}
      <Table rows={[{label: 'Total size', value: formatBytes(result.totalSizeBytes)}]} />
      {result.mixedAnnotationFormats && <StatusLine text="Warning: mixed annotation formats detected." />}
    </Box>
  );
}

function DatasetValidateScreen({
  dir,
  format,
  fix
}: {
  dir: string;
  format: AnnotationFormat;
  fix: boolean;
}): React.JSX.Element {
  const {exit} = useApp();
  const [state, setState] = useState<{loading: boolean; result?: ValidationResult; error?: string}>({
    loading: true
  });

  useEffect(() => {
    void (async () => {
      try {
        const result = await validateDataset(dir, format, fix);
        setState({loading: false, result});
      } catch (error: unknown) {
        setState({loading: false, error: formatError(error)});
      }
    })();
  }, [dir, fix, format]);

  useEffect(() => {
    if (!state.loading) {
      setTimeout(exit, 0);
    }
  }, [exit, state.loading]);

  if (state.loading) {
    return (
      <Box paddingLeft={2}>
        <Spinner label={`Validating ${format.toUpperCase()}: ${dir}`} />
      </Box>
    );
  }

  if (state.error) {
    return <ErrorView message={state.error} />;
  }

  const result = state.result!;
  const issueCounts = new Map<string, number>();
  for (const issue of result.issues) {
    issueCounts.set(issue.type, (issueCounts.get(issue.type) ?? 0) + 1);
  }

  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        <Text>{`Validating ${format.toUpperCase()}: ${dir}`}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text>───────────────────────────────────────</Text>
      </Box>
      <Table
        rows={[
          {label: 'Scanned', value: result.scannedImages.toLocaleString()},
          {label: 'Valid', value: result.validImages.toLocaleString()},
          {label: 'Issues', value: result.issues.length.toLocaleString()}
        ]}
      />
      {issueCounts.size > 0 && (
        <>
          <Box paddingLeft={2} marginTop={1}>
            <Text>Issue breakdown</Text>
          </Box>
          <Table
            rows={[...issueCounts.entries()].map(([label, count]) => ({
              label,
              value: count.toLocaleString()
            }))}
            indent={4}
          />
        </>
      )}
      {result.issues.length > 0 && (
        <>
          <Box paddingLeft={2} marginTop={1}>
            <Text>Affected files (first 10)</Text>
          </Box>
          <Table
            rows={result.issues.slice(0, 10).map((issue) => ({
              label: issue.file,
              value: issue.detail
            }))}
            indent={4}
          />
        </>
      )}
      <Box paddingLeft={2}>
        <Text>───────────────────────────────────────</Text>
      </Box>
      {fix ? (
        <StatusLine text={`Fixed: ${result.fixedCount}  Manual review: ${result.manualReviewCount}`} />
      ) : (
        <StatusLine text="Run with --fix to attempt auto-repair" />
      )}
    </Box>
  );
}

function DatasetSplitScreen(props: {
  dir: string;
  format: AnnotationFormat;
  output: string;
  seed: number;
  train: number;
  val: number;
  test: number;
}): React.JSX.Element {
  const {exit} = useApp();
  const [state, setState] = useState<{loading: boolean; result?: SplitResult; error?: string}>({loading: true});

  useEffect(() => {
    void (async () => {
      try {
        const result = await splitDataset(
          props.dir,
          props.format,
          props.output,
          {train: props.train, val: props.val, test: props.test},
          props.seed
        );
        setState({loading: false, result});
      } catch (error: unknown) {
        setState({loading: false, error: formatError(error)});
      }
    })();
  }, [props.dir, props.format, props.output, props.seed, props.test, props.train, props.val]);

  useEffect(() => {
    if (!state.loading) {
      setTimeout(exit, 0);
    }
  }, [exit, state.loading]);

  if (state.loading) {
    return (
      <Box paddingLeft={2}>
        <Spinner label={`Splitting: ${props.dir} (seed: ${props.seed})`} />
      </Box>
    );
  }

  if (state.error) {
    return <ErrorView message={state.error} />;
  }

  const result = state.result!;
  const classKeys = [...new Set(result.splits.flatMap((split) => Object.keys(split.classCounts)))].sort(
    (left, right) => Number(left) - Number(right)
  );

  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        <Text>{`Splitting: ${props.dir}  (seed: ${props.seed})`}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text>───────────────────────────────────────</Text>
      </Box>
      <Table
        rows={result.splits.map((split) => ({
          label: `${split.name} (${split.percent}%)`,
          value: [split.imageCount.toString(), ...classKeys.map((key) => String(split.classCounts[key] ?? 0))].join('  ')
        }))}
      />
      <StatusLine
        text={`Classes: ${classKeys.length > 0 ? classKeys.join(', ') : 'none'}   Output: ${result.outputDir}`}
      />
    </Box>
  );
}

function DatasetDupesScreen({
  dir,
  threshold,
  deleteMode
}: {
  dir: string;
  threshold: number;
  deleteMode: boolean;
}): React.JSX.Element {
  const {exit} = useApp();
  const [state, setState] = useState<{
    loading: boolean;
    result?: DupesWorkerResult;
    error?: string;
    currentGroupIndex: number;
    deleted: string[];
    phase: 'scan' | 'choose' | 'done';
  }>({loading: true, currentGroupIndex: 0, deleted: [], phase: 'scan'});

  useEffect(() => {
    void (async () => {
      try {
        await assertDirectoryExists(dir);
        const result = await runPythonWorker<DupesWorkerResult>('phash_worker.py', [
          '--dir',
          path.resolve(dir),
          '--threshold',
          String(threshold)
        ]);
        setState((current) => ({
          ...current,
          loading: false,
          result,
          phase: deleteMode && result.groups.length > 0 ? 'choose' : 'done'
        }));
      } catch (error: unknown) {
        setState((current) => ({...current, loading: false, error: formatError(error), phase: 'done'}));
      }
    })();
  }, [deleteMode, dir, threshold]);

  useEffect(() => {
    if (!state.loading && state.phase === 'done') {
      setTimeout(exit, 0);
    }
  }, [deleteMode, exit, state.loading, state.phase]);

  const result = state.result;
  const currentGroup = result?.groups[state.currentGroupIndex];

  if (state.loading) {
    return (
      <Box paddingLeft={2}>
        <Spinner label={`Scanning for duplicates: ${dir}  (threshold: ${threshold})`} />
      </Box>
    );
  }

  if (state.error) {
    return <ErrorView message={state.error} />;
  }

  if (!result) {
    return <ErrorView message="Duplicate scan returned no result." />;
  }

  if (state.phase === 'choose' && currentGroup) {
    return (
      <Box flexDirection="column">
        <DupesSummary dir={dir} threshold={threshold} result={result} />
        <Box paddingLeft={2} marginTop={1}>
          <Text>{`Keep which file? Group ${state.currentGroupIndex + 1} (distance: ${currentGroup.distance})`}</Text>
        </Box>
        <Box paddingLeft={4}>
          <Select
            options={currentGroup.files.map((file, index) => ({
              label: `[${index + 1}] ${file}`,
              value: file
            }))}
            onChange={(selectedFile) => {
              void (async () => {
                const root = path.resolve(dir);
                const removed: string[] = [];
                for (const file of currentGroup.files) {
                  if (file === selectedFile) {
                    continue;
                  }

                  await deleteDuplicateArtifacts(root, file);
                  removed.push(file);
                }

                setState((current) => {
                  const nextIndex = current.currentGroupIndex + 1;
                  const nextPhase = nextIndex >= (current.result?.groups.length ?? 0) ? 'done' : 'choose';
                  return {
                    ...current,
                    currentGroupIndex: nextIndex,
                    deleted: [...current.deleted, ...removed],
                    phase: nextPhase
                  };
                });
              })().catch((error: unknown) => {
                setState((current) => ({
                  ...current,
                  error: formatError(error),
                  phase: 'done'
                }));
              });
            }}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <DupesSummary dir={dir} threshold={threshold} result={result} />
      {deleteMode ? (
        <StatusLine text={`Deleted ${state.deleted.length} duplicate file(s).`} />
      ) : (
        <StatusLine text="Run with --delete to remove duplicates interactively" />
      )}
    </Box>
  );
}

function DupesSummary({
  dir,
  threshold,
  result
}: {
  dir: string;
  threshold: number;
  result: DupesWorkerResult;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        <Text>{`Scanning for duplicates: ${dir}  (threshold: ${threshold})`}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text>───────────────────────────────────────</Text>
      </Box>
      <Table
        rows={[
          {label: 'Scanned', value: result.scanned.toLocaleString()},
          {label: 'Dupe groups', value: result.groups.length.toLocaleString()},
          {label: 'Duplicates', value: result.total_dupes.toLocaleString()}
        ]}
      />
      {result.groups.slice(0, 5).map((group, index) => (
        <Box key={`${group.distance}:${index}`} flexDirection="column" paddingLeft={2} marginTop={1}>
          <Text>{`Group ${index + 1}  (distance: ${group.distance})`}</Text>
          {group.files.map((file, fileIndex) => (
            <Box key={file} paddingLeft={2}>
              <Text>{`[${fileIndex + 1}] ${file}`}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

function DatasetStatsScreen({dir}: {dir: string}): React.JSX.Element {
  const {exit} = useApp();
  const [state, setState] = useState<{loading: boolean; result?: StatsWorkerResult; error?: string}>({
    loading: true
  });

  useEffect(() => {
    void (async () => {
      try {
        await assertDirectoryExists(dir);
        const result = await runPythonWorker<StatsWorkerResult>('stats_worker.py', ['--dir', path.resolve(dir)]);
        setState({loading: false, result});
      } catch (error: unknown) {
        setState({loading: false, error: formatError(error)});
      }
    })();
  }, [dir]);

  useEffect(() => {
    if (!state.loading) {
      setTimeout(exit, 0);
    }
  }, [exit, state.loading]);

  if (state.loading) {
    return (
      <Box paddingLeft={2}>
        <Spinner label={`Dataset statistics: ${dir}`} />
      </Box>
    );
  }

  if (state.error) {
    return <ErrorView message={state.error} />;
  }

  const result = state.result!;
  const maxAspect = Math.max(...Object.values(result.aspect_ratios), 0);

  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        <Text>{`Dataset statistics: ${dir}`}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text>───────────────────────────────────────</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text>Channel stats  (mean ± std)</Text>
      </Box>
      <Table
        rows={Object.entries(result.channel_stats).map(([channel, stats]) => ({
          label: channel,
          value: `${stats.mean.toFixed(1)} ± ${stats.std.toFixed(1)}`
        }))}
        indent={4}
      />
      <Box paddingLeft={2} marginTop={1}>
        <Text>Dimensions</Text>
      </Box>
      <Table
        rows={Object.entries(result.dimensions).map(([axis, stats]) => ({
          label: axis[0].toUpperCase() + axis.slice(1),
          value: `min: ${stats.min}   max: ${stats.max}   mean: ${Math.round(stats.mean)}`
        }))}
        indent={4}
      />
      <Box paddingLeft={2} marginTop={1}>
        <Text>Aspect ratios</Text>
      </Box>
      <Table
        rows={Object.entries(result.aspect_ratios).map(([label, value]) => ({
          label: label[0].toUpperCase() + label.slice(1),
          value: `${Math.round(value * 100)}%  ${renderBar(value, maxAspect)}`
        }))}
        indent={4}
      />
      <Box paddingLeft={2} marginTop={1}>
        <Text>File sizes</Text>
      </Box>
      <Table
        rows={[
          {label: 'Min', value: humanizeKilobytes(result.file_sizes.min_kb)},
          {label: 'Max', value: humanizeKilobytes(result.file_sizes.max_kb)},
          {label: 'Mean', value: humanizeKilobytes(result.file_sizes.mean_kb)},
          {label: 'Median', value: humanizeKilobytes(result.file_sizes.median_kb)}
        ]}
        indent={4}
      />
    </Box>
  );
}

function ErrorView({message}: {message: string}): React.JSX.Element {
  return (
    <Box paddingLeft={2}>
      <Text color="red">{`Error: ${message}`}</Text>
    </Box>
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error.';
}

function humanizeKilobytes(value: number): string {
  if (value < 1024) {
    return `${value.toFixed(0)} KB`;
  }

  return `${(value / 1024).toFixed(1)} MB`;
}

async function normalizeFormat(dir: string, input?: string): Promise<AnnotationFormat> {
  if (input === 'yolo' || input === 'coco' || input === 'pascal-voc') {
    return input;
  }

  const detected = await detectAnnotationFormat(path.resolve(dir));
  return detected ?? 'yolo';
}
