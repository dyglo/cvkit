import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {parseAnomalyResponse} from '../src/commands/anomaly.js';
import {
  parseLabelAssistResponse,
  renderLabelAssistLines
} from '../src/commands/label-assist.js';
import {loadConfig, setConfigValue} from '../src/lib/config.js';
import {getPool} from '../src/lib/db.js';
import {clearHistory, runMigrations} from '../src/lib/history.js';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cliEntry = path.join(projectRoot, 'src', 'cli.ts');
const sampleImage = path.join(projectRoot, 'test', 'fixtures', 'sample.png');

test('anomaly errors cleanly when OPENAI_API_KEY not set', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'cvkit-home-'));
  const imageDir = await mkdtemp(path.join(os.tmpdir(), 'cvkit-anomaly-'));

  try {
    await cp(sampleImage, path.join(imageDir, 'sample.png'));
    const result = await runCli(['anomaly', imageDir], {home});

    assert.equal(result.code, 1);
    assert.match(result.stderr, /OpenAI API key not set/);
  } finally {
    await safeCleanup(home);
    await safeCleanup(imageDir);
  }
});

test('anomaly parses vision JSON response correctly', () => {
  const parsed = parseAnomalyResponse(`{"is_anomaly":true,"confidence":"high","reason":"Severe motion blur"}`);
  assert.deepEqual(parsed, {
    status: 'ok',
    isAnomaly: true,
    confidence: 'high',
    reason: 'Severe motion blur'
  });
});

test('anomaly handles malformed JSON from API gracefully', () => {
  const parsed = parseAnomalyResponse('not json');
  assert.equal(parsed.status, 'unknown');
  assert.equal(parsed.isAnomaly, false);
  assert.equal(parsed.confidence, 'unknown');
  assert.match(parsed.reason, /Malformed JSON response/);
});

test('label-assist errors when --classes flag missing', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'cvkit-home-'));

  try {
    const result = await runCli(['label-assist', sampleImage], {home});
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Missing required flag: --classes/);
  } finally {
    await safeCleanup(home);
  }
});

test('label-assist formats YOLO output correctly from parsed response', () => {
  const parsed = parseLabelAssistResponse([
    'ANNOTATIONS:',
    '0 0.512 0.423 0.234 0.187',
    '1 0.234 0.612 0.089 0.201',
    'NOTES:',
    '- class: car, confidence: high, note: clearly visible',
    '- class: person, confidence: medium, note: partially occluded'
  ].join('\n'));
  const rendered = renderLabelAssistLines(parsed, ['car', 'person', 'truck']);

  assert.deepEqual(rendered, [
    {
      yoloLine: '0 0.512 0.423 0.234 0.187',
      className: 'car',
      confidence: 'high',
      note: 'clearly visible'
    },
    {
      yoloLine: '1 0.234 0.612 0.089 0.201',
      className: 'person',
      confidence: 'medium',
      note: 'partially occluded'
    }
  ]);
});

test('getPool throws correct error when DATABASE_URL not set', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  delete process.env.HOME;
  delete process.env.USERPROFILE;

  try {
    assert.throws(
      () => getPool(),
      /Database not configured\.\nRun: cvkit config set DATABASE_URL=postgresql:\/\/localhost:5432\/cvkit/
    );
  } finally {
    restoreEnv('HOME', originalHome);
    restoreEnv('USERPROFILE', originalUserProfile);
  }
});

test('cvkit history list exits cleanly when DATABASE_URL not set', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'cvkit-home-'));

  try {
    const result = await runCli(['history', 'list'], {home});
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Run: cvkit config set DATABASE_URL=\.\.\./);
  } finally {
    await safeCleanup(home);
  }
});

test('db migrate applies migrations in filename order', async () => {
  const migrationsDir = await mkdtemp(path.join(os.tmpdir(), 'cvkit-migrations-'));
  const seen: string[] = [];
  const {writeFile} = await import('node:fs/promises');

  try {
    await writeFile(path.join(migrationsDir, '003_last.sql'), 'third', 'utf8');
    await writeFile(path.join(migrationsDir, '001_first.sql'), 'first', 'utf8');
    await writeFile(path.join(migrationsDir, '002_second.sql'), 'second', 'utf8');

    const files = await runMigrations(migrationsDir, async (sql) => {
      seen.push(sql);
    });

    assert.deepEqual(files, ['001_first.sql', '002_second.sql', '003_last.sql']);
    assert.deepEqual(seen, ['first', 'second', 'third']);
  } finally {
    await safeCleanup(migrationsDir);
  }
});

test('history clear removes generic, anomaly, and label-assist history in order', async () => {
  const statements: string[] = [];
  await clearHistory(async (sql) => {
    statements.push(sql);
    return [];
  });

  assert.deepEqual(statements, [
    'DELETE FROM label_assist_runs',
    'DELETE FROM anomaly_runs',
    'DELETE FROM describe_runs',
    'DELETE FROM runs'
  ]);
});

test('loadConfig remains compatible with config set/list storage', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'cvkit-home-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;

  try {
    await setConfigValue('OPENAI_API_KEY', 'sk-test');
    await setConfigValue('DATABASE_URL', 'postgresql://localhost:5432/cvkit');

    const config = loadConfig();
    assert.equal(config.OPENAI_API_KEY, 'sk-test');
    assert.equal(config.DATABASE_URL, 'postgresql://localhost:5432/cvkit');
  } finally {
    restoreEnv('HOME', originalHome);
    restoreEnv('USERPROFILE', originalUserProfile);
    await safeCleanup(home);
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

async function safeCleanup(target: string): Promise<void> {
  await rm(target, {recursive: true, force: true});
}

function restoreEnv(key: 'HOME' | 'USERPROFILE', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
