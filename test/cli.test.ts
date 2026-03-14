import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {detectWorkspace, resetWorkspaceCacheForTests} from '../src/lib/workspace.js';
import {resolvePath} from '../src/lib/resolve.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cliEntry = path.join(projectRoot, 'dist', 'index.js');
const fixturesDir = path.join(projectRoot, 'test', 'fixtures');
const sampleJpg = path.join(projectRoot, 'test', 'fixtures', 'sample.jpg');
const samplePng = path.join(projectRoot, 'test', 'fixtures', 'sample.png');
const nonImage = path.join(projectRoot, 'test', 'fixtures', 'not-image.txt');

test('cvkit --version returns package version', async () => {
  const result = await runCli(['--version']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^0\.1\.0\r?\n$/);
});

test('cvkit --help returns usage information', async () => {
  const result = await runCli(['--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage: cvkit/);
  assert.match(result.stdout, /inspect/);
  assert.match(result.stdout, /config/);
  assert.doesNotMatch(result.stdout, /dataset|convert|describe|anomaly|history|label-assist|ask/);
});

test('bare cvkit renders splash and exits after Enter', async () => {
  const result = await runCli([], {input: '\nexit\n'});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /C O M P U T E R\s+V I S I O N\s+T O O L K I T/);
  assert.match(result.stdout, /Press Enter to continue/);
  assert.match(result.stdout, /Workspace:\s+cvkit/);
  assert.match(result.stdout, /cvkit > exit/);
  assert.match(result.stdout, /Goodbye\./);
});

test('repl mounts and renders persistent input prompt', async () => {
  const result = await runCli([], {input: '\nhelp\nexit\n'});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /cvkit > help/);
  assert.match(result.stdout, /cvkit > exit/);
});

test('repl empty input does not add a message', async () => {
  const result = await runCli([], {input: '\n\nexit\n'});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /cvkit > \r?\ncvkit > exit/);
  assert.doesNotMatch(result.stdout, /Unknown command/);
});

test('repl help command returns available commands', async () => {
  const result = await runCli([], {input: '\nhelp\nexit\n'});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Available commands/);
  assert.match(result.stdout, /inspect <path>/);
  assert.match(result.stdout, /ls \[subdir\]/);
  assert.match(result.stdout, /pwd/);
});

test('repl unknown command returns a suggestion', async () => {
  const result = await runCli([], {input: '\nblah\nexit\n'});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Unknown command: blah/);
  assert.match(result.stdout, /Type help to see available commands\./);
});

test('repl exit command exits cleanly', async () => {
  const result = await runCli([], {input: '\nexit\n'});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Goodbye\./);
});

test('repl inspect reports metadata for a JPEG image', async () => {
  const result = await runCli([], {input: `\ninspect ${sampleJpg}\nexit\n`});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Dimensions\s+100 × 100/);
  assert.match(result.stdout, /Format\s+JPEG/);
});

test('repl inspect fails for a missing image', async () => {
  const result = await runCli([], {input: '\ninspect missing-image.png\nexit\n'});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /File not found/);
});

test('repl inspect fails for a non-image file', async () => {
  const result = await runCli([], {input: `\ninspect ${nonImage}\nexit\n`});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Unsupported format|Corrupt or unreadable image/);
});

test('repl config list and set work with masked secrets', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'cvkit-repl-home-'));

  try {
    const result = await runCli([], {
      input: '\nconfig list\nconfig set OPENAI_API_KEY=sk-test-secret\nconfig list\nexit\n',
      home
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /No config values set\./);
    assert.match(result.stdout, /OPENAI_API_KEY saved to/);
    assert.match(result.stdout, /OPENAI_API_KEY\s+sk\*+et/);

    const configPath = path.join(home, '.cvkit', 'config.json');
    const stored = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, string>;
    assert.equal(stored.OPENAI_API_KEY, 'sk-test-secret');
  } finally {
    await rm(home, {recursive: true, force: true});
  }
});

test('detectWorkspace finds images in the fixtures directory', async () => {
  const originalCwd = process.cwd();

  try {
    process.chdir(fixturesDir);
    resetWorkspaceCacheForTests();

    const workspace = await detectWorkspace();
    assert.equal(workspace.cwd, fixturesDir);
    assert.equal(workspace.name, 'fixtures');
    assert.equal(workspace.totalImages, 12);
    assert.equal(workspace.imageFiles[0], 'sample.jpg');
    assert.equal(workspace.imageFiles[1], 'sample.png');
    assert.match(workspace.imageFiles.at(-1) ?? '', /synthetic_yolo\/images\/sample_10\.png/);
    assert.match(workspace.labelFiles[0] ?? '', /not-image\.txt/);
    assert.match(workspace.labelFiles.at(-1) ?? '', /synthetic_yolo\/labels\/sample_10\.txt/);
  } finally {
    process.chdir(originalCwd);
    resetWorkspaceCacheForTests();
  }
});

test('resolvePath resolves bare filename relative to cwd', async () => {
  const originalCwd = process.cwd();

  try {
    process.chdir(fixturesDir);
    resetWorkspaceCacheForTests();
    await detectWorkspace();

    assert.equal(resolvePath('sample.jpg', fixturesDir), sampleJpg);
  } finally {
    process.chdir(originalCwd);
    resetWorkspaceCacheForTests();
  }
});

test('resolvePath resolves ./relative paths correctly', () => {
  assert.equal(resolvePath('./test/fixtures/sample.png', projectRoot), samplePng);
});

test('resolvePath passes through absolute paths unchanged', () => {
  assert.equal(resolvePath(sampleJpg, projectRoot), sampleJpg);
});

test('repl shows workspace header on startup', async () => {
  const result = await runCli([], {input: '\nexit\n', cwd: fixturesDir});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Workspace:\s+fixtures/);
  assert.match(result.stdout, new RegExp(`Path:\\s+${escapeRegExp(fixturesDir)}`));
  assert.match(result.stdout, /Images:\s+12 files found/);
  assert.match(result.stdout, /Labels:\s+12 annotation files found/);
});

test('repl prompt includes workspace name', async () => {
  const result = await runCli([], {input: '\nhelp\nexit\n', cwd: fixturesDir});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /fixtures > help/);
  assert.match(result.stdout, /fixtures > exit/);
});

test('repl inspect resolves bare filenames from the working directory', async () => {
  const result = await runCli([], {input: '\ninspect sample.jpg\nexit\n', cwd: fixturesDir});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Dimensions\s+100 × 100/);
  assert.match(result.stdout, /Format\s+JPEG/);
});

test('ls command lists image and label files', async () => {
  const result = await runCli([], {input: '\nls\nexit\n', cwd: fixturesDir});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /images\//);
  assert.match(result.stdout, /sample\.jpg\s+JPEG\s+100×100/);
  assert.match(result.stdout, /sample\.png\s+PNG\s+100×100/);
  assert.match(result.stdout, /synthetic_yolo\/images\/sample_10\.png\s+PNG\s+640×640/);
  assert.match(result.stdout, /labels\//);
  assert.match(result.stdout, /not-image\.txt/);
  assert.match(result.stdout, /synthetic_yolo\/labels\/sample_10\.txt/);
  assert.match(result.stdout, /12 images, 12 labels/);
});

test('pwd command shows current working directory', async () => {
  const result = await runCli([], {input: '\npwd\nexit\n', cwd: fixturesDir});
  assert.equal(result.code, 0);
  assert.match(result.stdout, new RegExp(escapeRegExp(fixturesDir)));
});

test('inspect reports metadata for a JPEG image', async () => {
  const result = await runCli(['inspect', sampleJpg]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Dimensions\s+100 × 100/);
  assert.match(result.stdout, /Format\s+JPEG/);
});

test('inspect reports metadata for a PNG image', async () => {
  const result = await runCli(['inspect', samplePng]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Dimensions\s+100 × 100/);
  assert.match(result.stdout, /Format\s+PNG/);
});

test('single-shot inspect resolves bare filenames from the working directory', async () => {
  const result = await runCli(['inspect', 'sample.jpg'], {cwd: fixturesDir});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Format\s+JPEG/);
});

test('inspect fails for a missing image', async () => {
  const result = await runCli(['inspect', 'missing-image.png']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /File not found/);
});

test('inspect fails for a non-image file', async () => {
  const result = await runCli(['inspect', nonImage]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unsupported format|Corrupt or unreadable image/);
});

test('config set creates config file and config list masks secrets', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'cvkit-home-'));

  try {
    let result = await runCli(['config', 'list'], {home});
    assert.equal(result.code, 0);
    assert.match(result.stdout, /No config values set\./);

    result = await runCli(['config', 'set', 'OPENAI_API_KEY=sk-example-secret'], {home});
    assert.equal(result.code, 0);

    result = await runCli(['config', 'list'], {home});
    assert.equal(result.code, 0);
    assert.match(result.stdout, /OPENAI_API_KEY/);
    assert.doesNotMatch(result.stdout, /sk-example-secret/);

    const configPath = path.join(home, '.cvkit', 'config.json');
    const stored = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, string>;
    assert.equal(stored.OPENAI_API_KEY, 'sk-example-secret');
  } finally {
    await rm(home, {recursive: true, force: true});
  }
});

function runCli(
  args: string[],
  options: {input?: string; home?: string; cwd?: string} = {}
): Promise<{code: number; stdout: string; stderr: string}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cliEntry, ...args],
      {
        cwd: options.cwd ?? projectRoot,
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
