import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {parseConvertFormat} from '../src/lib/convert.js';
import {resolvePythonWorkerPath} from '../src/lib/python.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cliEntry = path.join(projectRoot, 'src', 'cli.ts');
const syntheticYolo = path.join(projectRoot, 'test', 'fixtures', 'synthetic_yolo');

test('parseConvertFormat accepts supported formats and rejects invalid ones', () => {
  assert.equal(parseConvertFormat('yolo'), 'yolo');
  assert.equal(parseConvertFormat('coco'), 'coco');
  assert.equal(parseConvertFormat('pascal-voc'), 'pascal-voc');
  assert.equal(parseConvertFormat('labelme'), 'labelme');
  assert.equal(parseConvertFormat('cvat'), 'cvat');
  assert.throws(
    () => parseConvertFormat('voc'),
    /Supported formats: yolo, coco, pascal-voc, labelme, cvat/
  );
});

test('resolvePythonWorkerPath handles both source and bundled layouts', () => {
  const sourceBase = new URL('file:///D:/projects/cvkit/src/lib/python.ts');
  const distBase = new URL('file:///D:/projects/cvkit/dist/index.js');

  assert.match(resolvePythonWorkerPath('convert_worker.py', sourceBase.href), /workers[\\/]convert_worker\.py$/);
  assert.equal(
    resolvePythonWorkerPath('convert_worker.py', distBase.href),
    path.join(projectRoot, 'workers', 'convert_worker.py')
  );
});

test('convert yolo to coco writes annotations json with expected keys', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'cvkit-convert-coco-'));

  try {
    const result = await runCli([
      'convert',
      syntheticYolo,
      '--from',
      'yolo',
      '--to',
      'coco',
      '--output',
      outputDir
    ]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Converting:\s+.*synthetic_yolo/);
    assert.match(result.stdout, /yolo → coco/);
    assert.match(result.stdout, /Images processed\s+10/);
    assert.match(result.stdout, /Annotations converted\s+24/);

    const output = JSON.parse(await readFile(path.join(outputDir, 'annotations.json'), 'utf8')) as {
      images?: unknown[];
      annotations?: unknown[];
      categories?: unknown[];
    };
    assert.ok(Array.isArray(output.images));
    assert.ok(Array.isArray(output.annotations));
    assert.ok(Array.isArray(output.categories));
  } finally {
    await safeCleanup(outputDir);
  }
});

test('convert yolo to pascal-voc writes xml annotations', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'cvkit-convert-voc-'));

  try {
    const result = await runCli([
      'convert',
      syntheticYolo,
      '--from',
      'yolo',
      '--to',
      'pascal-voc',
      '--output',
      outputDir
    ]);

    assert.equal(result.code, 0);
    const annotationsDir = path.join(outputDir, 'annotations');
    const info = await stat(annotationsDir);
    assert.ok(info.isDirectory());
    const xmlOne = await readFile(path.join(annotationsDir, 'sample_01.xml'), 'utf8');
    assert.match(xmlOne, /<annotation>/);
  } finally {
    await safeCleanup(outputDir);
  }
});

test('convert --dry-run does not write output files', async () => {
  const outputDir = path.join(await mkdtemp(path.join(os.tmpdir(), 'cvkit-convert-dry-parent-')), 'converted');

  try {
    const result = await runCli([
      'convert',
      syntheticYolo,
      '--from',
      'yolo',
      '--to',
      'coco',
      '--output',
      outputDir,
      '--dry-run'
    ]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Dry run — no files will be written/);
    await assert.rejects(() => stat(outputDir));
  } finally {
    await safeCleanup(path.dirname(outputDir));
  }
});

test('convert resolves relative output paths in dry-run output', async () => {
  const relativeOutput = path.join('test-output', 'convert-relative-check');
  const absoluteOutput = path.resolve(projectRoot, relativeOutput);

  try {
    const result = await runCli([
      'convert',
      syntheticYolo,
      '--from',
      'yolo',
      '--to',
      'coco',
      '--output',
      relativeOutput,
      '--dry-run'
    ]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, new RegExp(escapeForRegex(absoluteOutput.replace(/[\\/]+$/, ''))));
  } finally {
    await safeCleanup(path.join(projectRoot, 'test-output'));
  }
});

test('convert same format exits cleanly with warning and writes nothing', async () => {
  const outputDir = path.join(await mkdtemp(path.join(os.tmpdir(), 'cvkit-convert-same-parent-')), 'converted');

  try {
    const result = await runCli([
      'convert',
      syntheticYolo,
      '--from',
      'yolo',
      '--to',
      'yolo',
      '--output',
      outputDir
    ]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /No conversion performed/);
    await assert.rejects(() => stat(outputDir));
  } finally {
    await safeCleanup(path.dirname(outputDir));
  }
});

test('convert fails cleanly for a missing input directory', async () => {
  const result = await runCli([
    'convert',
    path.join(projectRoot, 'test', 'fixtures', 'missing-dataset'),
    '--from',
    'yolo',
    '--to',
    'coco'
  ]);

  assert.equal(result.code, 1);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /Input directory not found/);
  assert.doesNotMatch(output, /at\s/);
});

test('convert fails cleanly when YOLO classes metadata is missing', async () => {
  const datasetDir = await mkdtemp(path.join(os.tmpdir(), 'cvkit-convert-no-classes-'));
  const outputDir = path.join(datasetDir, 'out');

  try {
    await mkdir(path.join(datasetDir, 'images'), {recursive: true});
    await mkdir(path.join(datasetDir, 'labels'), {recursive: true});
    await copyTree(path.join(syntheticYolo, 'images'), path.join(datasetDir, 'images'));
    await copyTree(path.join(syntheticYolo, 'labels'), path.join(datasetDir, 'labels'));

    const result = await runCli([
      'convert',
      datasetDir,
      '--from',
      'yolo',
      '--to',
      'coco',
      '--output',
      outputDir
    ]);

    assert.equal(result.code, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, /YOLO conversion requires class names/);
  } finally {
    await safeCleanup(datasetDir);
  }
});

test('convert refuses to overwrite a non-empty output directory', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'cvkit-convert-existing-'));
  const markerFile = path.join(outputDir, 'keep.txt');

  try {
    const fs = await import('node:fs/promises');
    await fs.writeFile(markerFile, 'preserve me\n', 'utf8');

    const result = await runCli([
      'convert',
      syntheticYolo,
      '--from',
      'yolo',
      '--to',
      'coco',
      '--output',
      outputDir
    ]);

    assert.equal(result.code, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, /already\s+exists and is not empty/);
    assert.equal(await readFile(markerFile, 'utf8'), 'preserve me\n');
  } finally {
    await safeCleanup(outputDir);
  }
});

function runCli(
  args: string[],
  options: {home?: string} = {}
): Promise<{code: number; stdout: string; stderr: string}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
      cwd: projectRoot,
      env: {
        ...process.env,
        HOME: options.home ?? process.env.HOME,
        USERPROFILE: options.home ?? process.env.USERPROFILE
      },
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? 0,
        stdout,
        stderr
      });
    });

    child.stdin.end();
  });
}

async function copyTree(source: string, destination: string): Promise<void> {
  const fs = await import('node:fs/promises');
  await fs.cp(source, destination, {recursive: true});
}

async function safeCleanup(target: string): Promise<void> {
  await rm(target, {recursive: true, force: true});
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
