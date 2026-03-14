import {readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {Command} from 'commander';
import {createRun, finishRun, recordAnomalyRun} from '../lib/history.js';
import {isSupportedImagePath} from '../lib/image.js';
import {getOpenAIClient, VISION_MODEL} from '../lib/openai.js';
import {imageToBase64} from '../lib/vision.js';

const ANOMALY_PROMPT = `You are a quality control assistant for computer vision datasets.
Analyze this image and determine if it is anomalous or unsuitable for CV training.

Flag as anomalous if you detect:
- Severe blur or motion blur
- Extreme overexposure or underexposure
- Corrupted or partially loaded image artifacts
- Near-blank or solid color frames
- Severe occlusion making the scene uninterpretable

Respond ONLY in this JSON format:
{
  "is_anomaly": true|false,
  "confidence": "low|medium|high",
  "reason": "one sentence reason, or null if not anomalous"
}`;

export type AnomalyThreshold = 'low' | 'medium' | 'high';
export type ParsedAnomalyResult =
  | {
      status: 'ok';
      isAnomaly: boolean;
      confidence: AnomalyThreshold;
      reason: string | null;
    }
  | {
      status: 'unknown';
      isAnomaly: false;
      confidence: 'unknown';
      reason: string;
    };

type AnomalyScanRow = ParsedAnomalyResult & {
  imagePath: string;
  tokensUsed: number;
};

type FlaggedAnomalyRow = Extract<AnomalyScanRow, {status: 'ok'; isAnomaly: true}>;

export function registerAnomaly(program: Command): void {
  program
    .command('anomaly')
    .description('Scan a directory for anomalous images')
    .argument('<dir>', 'Directory containing images')
    .option('--threshold <level>', 'Confidence threshold (low|medium|high)', 'medium')
    .action(async (dir: string, options: {threshold?: string}) => {
      const threshold = normalizeThreshold(options.threshold);
      const dirPath = path.resolve(dir);
      const imagePaths = await collectImagePaths(dirPath);
      const client = getOpenAIClient();
      const startedAt = Date.now();
      const runId = await safeCreateRun('anomaly');
      const results: AnomalyScanRow[] = [];
      let totalTokens = 0;

      try {
        process.stdout.write(`  Scanning for anomalies: ${dir}  (threshold: ${threshold})\n`);
        process.stdout.write('  ─────────────────────────────────────────────────\n');

        for (const [index, imagePath] of imagePaths.entries()) {
          const current = index + 1;
          process.stdout.write(
            `  Scanning image ${current}/${imagePaths.length}...  [${renderProgressBar(
              current,
              imagePaths.length
            )}] ${Math.round((current / imagePaths.length) * 100)}%\n`
          );

          const base64 = imageToBase64(imagePath);
          const response = await client.chat.completions.create({
            model: VISION_MODEL,
            max_tokens: 150,
            messages: [
              {
                role: 'user',
                content: [
                  {type: 'text', text: ANOMALY_PROMPT},
                  {type: 'image_url', image_url: {url: base64}}
                ]
              }
            ]
          });

          const raw = response.choices[0]?.message?.content ?? '';
          const parsed = parseAnomalyResponse(raw);
          const tokensUsed = response.usage?.total_tokens ?? 0;
          totalTokens += tokensUsed;

          results.push({
            ...parsed,
            imagePath,
            tokensUsed
          });

          await safeRecordAnomalyRun({
            runId,
            dirPath,
            imagePath,
            isAnomaly: parsed.status === 'ok' ? parsed.isAnomaly : false,
            reason: parsed.reason,
            confidence: parsed.confidence,
            tokensUsed
          });
        }

        const csvName = `cvkit-anomaly-${formatFileTimestamp(new Date())}.csv`;
        const csvPath = path.resolve(process.cwd(), csvName);
        await writeAnomalyCsv(csvPath, results);
        process.stdout.write(`\n${formatAnomalySummary(results, threshold, csvName, totalTokens)}`);
        await safeFinishRun(runId, 'success', Date.now() - startedAt);
      } catch (error: unknown) {
        await safeFinishRun(runId, 'error', Date.now() - startedAt);
        throw error;
      }
    });
}

export function parseAnomalyResponse(raw: string): ParsedAnomalyResult {
  const sanitized = sanitizeModelText(raw);
  try {
    const parsed = JSON.parse(sanitized) as Record<string, unknown>;
    const isAnomaly = parsed.is_anomaly;
    const confidence = parsed.confidence;
    const reason = parsed.reason;

    if (typeof isAnomaly !== 'boolean') {
      throw new Error('is_anomaly must be boolean');
    }

    if (confidence !== 'low' && confidence !== 'medium' && confidence !== 'high') {
      throw new Error('confidence must be low, medium, or high');
    }

    if (reason !== null && typeof reason !== 'string') {
      throw new Error('reason must be string or null');
    }

    return {
      status: 'ok',
      isAnomaly,
      confidence,
      reason
    };
  } catch {
    return {
      status: 'unknown',
      isAnomaly: false,
      confidence: 'unknown',
      reason: `Malformed JSON response: ${truncateText(sanitized, 120)}`
    };
  }
}

export function shouldIncludeFlagged(
  confidence: AnomalyThreshold,
  threshold: AnomalyThreshold
): boolean {
  if (threshold === 'low') {
    return true;
  }

  if (threshold === 'medium') {
    return confidence === 'medium' || confidence === 'high';
  }

  return confidence === 'high';
}

export async function collectImagePaths(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, {withFileTypes: true});
  const imagePaths: string[] = [];

  for (const entry of entries) {
    const resolved = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      imagePaths.push(...(await collectImagePaths(resolved)));
      continue;
    }

    if (entry.isFile() && isSupportedImagePath(resolved)) {
      imagePaths.push(resolved);
    }
  }

  return imagePaths.sort((left, right) => left.localeCompare(right));
}

function normalizeThreshold(value?: string): AnomalyThreshold {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }

  throw new Error('Threshold must be one of: low, medium, high.');
}

function sanitizeModelText(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function renderProgressBar(current: number, total: number): string {
  const width = 12;
  if (total <= 0) {
    return '░'.repeat(width);
  }

  const filled = Math.round((current / total) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
}

function formatAnomalySummary(
  results: AnomalyScanRow[],
  threshold: AnomalyThreshold,
  csvName: string,
  totalTokens: number
): string {
  const anomalies = results.filter((result) => result.status === 'ok' && result.isAnomaly);
  const clean = results.filter((result) => result.status === 'ok' && !result.isAnomaly);
  const unknown = results.filter((result) => result.status === 'unknown');
  const flagged = anomalies.filter((result): result is FlaggedAnomalyRow =>
    shouldIncludeFlagged(result.confidence, threshold)
  );
  const anomalyPercent = results.length === 0 ? '0.0' : ((anomalies.length / results.length) * 100).toFixed(1);
  const lines = [
    '  Results',
    '  ─────────────────────────────────────────────────',
    `  Scanned      ${results.length.toLocaleString()} images`,
    `  Anomalies    ${anomalies.length.toLocaleString()}  (${anomalyPercent}%)`,
    `  Clean        ${clean.length.toLocaleString()}`
  ];

  if (unknown.length > 0) {
    lines.push(`  Unknown      ${unknown.length.toLocaleString()}`);
  }

  lines.push('', '  Flagged:');

  if (flagged.length === 0) {
    lines.push('    None at this threshold');
  } else {
    for (const row of flagged) {
      lines.push(
        `    ${path.basename(row.imagePath).padEnd(16)} ${row.confidence.padEnd(7)} ${row.reason ?? 'No reason provided'}`
      );
    }
  }

  if (unknown.length > 0) {
    lines.push('', '  Warnings:');
    for (const row of unknown) {
      lines.push(`    ${path.basename(row.imagePath)}   ${row.reason}`);
    }
  }

  lines.push(
    '  ─────────────────────────────────────────────────',
    `  Saved to: ./${csvName}`,
    `  Model: ${VISION_MODEL}  |  Total tokens: ${totalTokens.toLocaleString()}`,
    ''
  );

  return `${lines.join('\n')}\n`;
}

async function writeAnomalyCsv(csvPath: string, rows: AnomalyScanRow[]): Promise<void> {
  const lines = [
    'image_path,status,is_anomaly,confidence,reason,tokens_used',
    ...rows.map((row) =>
      [
        row.imagePath,
        row.status,
        row.status === 'ok' ? String(row.isAnomaly) : '',
        row.confidence,
        row.reason ?? '',
        String(row.tokensUsed)
      ]
        .map(escapeCsv)
        .join(',')
    )
  ];
  await writeFile(csvPath, `${lines.join('\n')}\n`, 'utf8');
}

function escapeCsv(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function formatFileTimestamp(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

async function safeCreateRun(command: string): Promise<number | null> {
  try {
    return await createRun({command});
  } catch {
    return null;
  }
}

async function safeRecordAnomalyRun(input: {
  runId: number | null;
  dirPath: string;
  imagePath: string;
  isAnomaly: boolean;
  reason: string | null;
  confidence: string;
  tokensUsed: number;
}): Promise<void> {
  try {
    await recordAnomalyRun(input);
  } catch {
    // Optional history should not fail the command.
  }
}

async function safeFinishRun(
  runId: number | null,
  status: 'success' | 'error',
  durationMs: number
): Promise<void> {
  try {
    await finishRun(runId, status, durationMs);
  } catch {
    // Optional history should not fail the command.
  }
}
