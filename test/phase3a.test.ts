import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {describeDirectory} from '../src/commands/describe.js';
import type {AIClient} from '../src/lib/ai-client.js';
import {setClientFactoryForTests} from '../src/lib/ai-client.js';
import {imageToBase64} from '../src/lib/vision.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cliEntry = path.join(projectRoot, 'src', 'cli.ts');
const samplePng = path.join(projectRoot, 'test', 'fixtures', 'sample.png');
const batchFixtureImagesDir = path.join(projectRoot, 'test', 'fixtures', 'synthetic_yolo', 'images');

test('imageToBase64 correctly encodes a PNG fixture', () => {
  const encoded = imageToBase64(samplePng);
  assert.ok(encoded.startsWith('data:image/png;base64,'));
  assert.ok(encoded.length > 'data:image/png;base64,'.length);
});

test('describe errors cleanly when GEMINI_API_KEY is not set', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'cvkit-phase3a-home-'));

  try {
    const result = await runCli(['describe', samplePng], {home});
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Gemini API key not set/);
    assert.match(result.stderr, /cvkit config set GEMINI_API_KEY=your-key/);
  } finally {
    await rm(home, {recursive: true, force: true});
  }
});

test('ask errors cleanly when --image flag is missing', async () => {
  const result = await runCli(['ask', 'What is in this image?']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /required option '--image <path>' not specified/);
});

test('ask errors cleanly when image file does not exist', async () => {
  const result = await runCli(['ask', 'What is in this image?', '--image', 'missing-image.png']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Image not found: missing-image\.png/);
});

test('batch describe creates CSV with correct headers', async (t) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'cvkit-phase3a-batch-'));
  const outputPath = path.join(outputDir, 'descriptions.csv');

  setClientFactoryForTests(() => createFakeAIClient());
  t.after(() => {
    setClientFactoryForTests(null);
  });

  try {
    const result = await describeDirectory(batchFixtureImagesDir, outputPath);
    assert.equal(result.failed, 0);

    const csv = await readFile(outputPath, 'utf8');
    const [header, ...rows] = csv.trim().split(/\r?\n/);
    assert.equal(header, 'filename,description,objects,suggested_tasks,quality_notes');
    assert.ok(rows.length >= 1);
  } finally {
    await rm(outputDir, {recursive: true, force: true});
  }
});

test('help output includes describe and ask', async () => {
  const result = await runCli(['--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /\bdescribe\b/);
  assert.match(result.stdout, /\bask\b/);
});

function createFakeAIClient(): AIClient {
  return {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          description: 'Synthetic scene for tests.',
          objects: ['person', 'car'],
          suggested_tasks: ['object detection', 'classification'],
          quality_notes: ['well lit']
        }),
        usageMetadata: {
          totalTokenCount: 42
        }
      })
    }
  };
}

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
