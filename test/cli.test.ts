import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cliEntry = path.join(projectRoot, 'src', 'cli.ts');
const sampleImage = path.join(projectRoot, 'test', 'fixtures', 'sample.svg');
const nonImage = path.join(projectRoot, 'test', 'fixtures', 'not-image.txt');

test('cvkit --version returns package version', async () => {
  const result = await runCli(['--version']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /0\.1\.0/);
});

test('cvkit --help returns usage information', async () => {
  const result = await runCli(['--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage: cvkit/);
  assert.match(result.stdout, /inspect/);
  assert.match(result.stdout, /config/);
});

test('bare cvkit renders splash and exits after Enter', async () => {
  const result = await runCli([], {input: '\r'});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /C O M P U T E R\s+V I S I O N\s+T O O L K I T/);
  assert.match(result.stdout, /Press Enter to continue/);
});

test('inspect reports metadata for a valid image', async () => {
  const result = await runCli(['inspect', sampleImage]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Dimensions\s+4 x 3/);
  assert.match(result.stdout, /Format\s+svg/);
});

test('inspect fails for a missing image', async () => {
  const result = await runCli(['inspect', 'missing-image.png']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Image not found/);
});

test('inspect fails for a non-image file', async () => {
  const result = await runCli(['inspect', nonImage]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unsupported image format|Corrupt or unreadable image file/);
});

test('config set creates config file and config list masks secrets', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'cvkit-home-'));

  try {
    let result = await runCli(['config', 'set', 'OPENAI_API_KEY=sk-example-secret'], {home});
    assert.equal(result.code, 0);

    result = await runCli(['config', 'set', 'MODEL=gpt-5.4'], {home});
    assert.equal(result.code, 0);

    result = await runCli(['config', 'list'], {home});
    assert.equal(result.code, 0);
    assert.match(result.stdout, /OPENAI_API_KEY/);
    assert.doesNotMatch(result.stdout, /sk-example-secret/);
    assert.match(result.stdout, /MODEL\s+gpt-5\.4/);

    const configPath = path.join(home, '.cvkit', 'config.json');
    const stored = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, string>;
    assert.equal(stored.OPENAI_API_KEY, 'sk-example-secret');
    assert.equal(stored.MODEL, 'gpt-5.4');
  } finally {
    await rm(home, {recursive: true, force: true});
  }
});

function runCli(
  args: string[],
  options: {input?: string; home?: string} = {}
): Promise<{code: number; stdout: string; stderr: string}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', cliEntry, ...args],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          HOME: options.home ?? process.env.HOME,
          USERPROFILE: options.home ?? process.env.USERPROFILE
        },
        stdio: 'pipe'
      }
    );

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

    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}
