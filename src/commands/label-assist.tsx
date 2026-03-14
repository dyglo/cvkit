import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {Command} from 'commander';
import {createRun, finishRun, recordLabelAssistRun} from '../lib/history.js';
import {inspectImage} from '../lib/image.js';
import {getOpenAIClient, VISION_MODEL} from '../lib/openai.js';
import {imageToBase64} from '../lib/vision.js';

const LABEL_ASSIST_PROMPT = `You are a CV annotation assistant.
Suggest bounding box annotations for these classes: {classes}

Respond in YOLO format (normalized 0.0–1.0):
<class_id> <x_center> <y_center> <width> <height>

Format your response as:
ANNOTATIONS:
0 0.512 0.423 0.234 0.187

NOTES:
- class: car, confidence: high, note: clearly visible`;

export type LabelAssistNote = {
  className: string;
  confidence: 'low' | 'medium' | 'high';
  note: string;
};

export type LabelAssistAnnotation = {
  classId: number;
  xCenter: number;
  yCenter: number;
  width: number;
  height: number;
};

export type ParsedLabelAssistResponse = {
  annotations: LabelAssistAnnotation[];
  notes: LabelAssistNote[];
};

export type RenderedLabelAssistLine = {
  yoloLine: string;
  className: string;
  confidence: 'low' | 'medium' | 'high' | 'unknown';
  note: string;
};

export function registerLabelAssist(program: Command): void {
  program
    .command('label-assist')
    .description('Suggest YOLO annotations for a single image')
    .argument('<imagePath>', 'Image path')
    .option('--classes <classes>', 'Comma-separated classes')
    .option('--save <path>', 'Save YOLO annotations to a file')
    .action(async (imagePath: string, options: {classes?: string; save?: string}) => {
      if (!options.classes) {
        throw new Error('Missing required flag: --classes "<class1,class2>"');
      }

      const resolvedImagePath = path.resolve(imagePath);
      const classes = parseClassList(options.classes);
      if (classes.length === 0) {
        throw new Error('At least one class is required.');
      }

      await inspectImage(resolvedImagePath);
      const client = getOpenAIClient();
      const startedAt = Date.now();
      const runId = await safeCreateRun('label-assist');

      try {
        const base64 = imageToBase64(resolvedImagePath);
        const response = await client.chat.completions.create({
          model: VISION_MODEL,
          max_tokens: 500,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: LABEL_ASSIST_PROMPT.replace('{classes}', classes.join(', '))
                },
                {type: 'image_url', image_url: {url: base64}}
              ]
            }
          ]
        });

        const content = response.choices[0]?.message?.content ?? '';
        const parsed = parseLabelAssistResponse(content);
        const renderedLines = renderLabelAssistLines(parsed, classes);
        const savePath = options.save ? path.resolve(options.save) : undefined;

        if (savePath) {
          await mkdir(path.dirname(savePath), {recursive: true});
          await writeFile(
            savePath,
            `${renderedLines.map((line) => line.yoloLine).join('\n')}${renderedLines.length > 0 ? '\n' : ''}`,
            'utf8'
          );
        }

        process.stdout.write(
          formatLabelAssistOutput(
            imagePath,
            classes,
            renderedLines,
            savePath,
            response.usage?.total_tokens ?? 0
          )
        );

        await safeRecordLabelAssistRun({
          runId,
          imagePath: resolvedImagePath,
          classes,
          savePath,
          annotations: renderedLines.map((line) => line.yoloLine),
          notes: renderedLines.map((line) =>
            line.note ? `class: ${line.className}, confidence: ${line.confidence}, note: ${line.note}` : ''
          ),
          tokensUsed: response.usage?.total_tokens ?? 0
        });
        await safeFinishRun(runId, 'success', Date.now() - startedAt);
      } catch (error: unknown) {
        await safeFinishRun(runId, 'error', Date.now() - startedAt);
        throw error;
      }
    });
}

export function parseClassList(input: string): string[] {
  return input
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function parseLabelAssistResponse(raw: string): ParsedLabelAssistResponse {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const annotationsStart = lines.findIndex((line) => line.toUpperCase() === 'ANNOTATIONS:');
  const notesStart = lines.findIndex((line) => line.toUpperCase() === 'NOTES:');
  if (annotationsStart === -1 || notesStart === -1 || notesStart < annotationsStart) {
    throw new Error('Invalid label-assist response format.');
  }

  const annotationLines = lines.slice(annotationsStart + 1, notesStart);
  const noteLines = lines.slice(notesStart + 1);

  return {
    annotations: annotationLines.map(parseAnnotationLine),
    notes: noteLines.filter((line) => line.startsWith('-') || line.startsWith('*')).map(parseNoteLine)
  };
}

export function renderLabelAssistLines(
  parsed: ParsedLabelAssistResponse,
  classes: string[]
): RenderedLabelAssistLine[] {
  return parsed.annotations.map((annotation, index) => {
    const note = parsed.notes[index] ?? parsed.notes.find((entry) => entry.className === (classes[annotation.classId] ?? ''));
    return {
      yoloLine: formatYoloLine(annotation),
      className: classes[annotation.classId] ?? `class_${annotation.classId}`,
      confidence: note?.confidence ?? 'unknown',
      note: note?.note ?? ''
    };
  });
}

function parseAnnotationLine(line: string): LabelAssistAnnotation {
  const match = line.match(/^(\d+)\s+([0-9]*\.?[0-9]+)\s+([0-9]*\.?[0-9]+)\s+([0-9]*\.?[0-9]+)\s+([0-9]*\.?[0-9]+)$/);
  if (!match) {
    throw new Error(`Invalid annotation line: ${line}`);
  }

  return {
    classId: Number(match[1]),
    xCenter: Number(match[2]),
    yCenter: Number(match[3]),
    width: Number(match[4]),
    height: Number(match[5])
  };
}

function parseNoteLine(line: string): LabelAssistNote {
  const normalized = line.replace(/^[-*]\s*/, '');
  const match = normalized.match(
    /^class:\s*([^,]+),\s*confidence:\s*(low|medium|high)(?:,\s*note:\s*(.+))?$/i
  );
  if (!match) {
    throw new Error(`Invalid note line: ${line}`);
  }

  return {
    className: match[1].trim(),
    confidence: match[2].toLowerCase() as LabelAssistNote['confidence'],
    note: match[3]?.trim() ?? ''
  };
}

function formatYoloLine(annotation: LabelAssistAnnotation): string {
  return [
    annotation.classId,
    annotation.xCenter.toFixed(3),
    annotation.yCenter.toFixed(3),
    annotation.width.toFixed(3),
    annotation.height.toFixed(3)
  ].join(' ');
}

function formatLabelAssistOutput(
  imagePath: string,
  classes: string[],
  lines: RenderedLabelAssistLine[],
  savePath: string | undefined,
  tokensUsed: number
): string {
  const classSummary = classes.map((label, index) => `${label} (${index})`).join(', ');
  const output = [
    `  Image:   ${path.basename(imagePath)}`,
    `  Classes: ${classSummary}`,
    '  ─────────────────────────────────────────',
    '  Suggested annotations (YOLO format):',
    ''
  ];

  if (lines.length === 0) {
    output.push('    No annotations suggested');
  } else {
    for (const line of lines) {
      const noteSuffix = line.note ? ` — ${line.note}` : '';
      output.push(
        `    ${line.yoloLine.padEnd(27)} ${line.className.padEnd(8)} ${line.confidence}${noteSuffix}`
      );
    }
  }

  output.push('', '  ─────────────────────────────────────────');
  if (savePath) {
    output.push(`  Saved to: ${savePath}`);
  }
  output.push(
    `  Model: ${VISION_MODEL}  |  Tokens used: ${tokensUsed.toLocaleString()}`,
    '',
    '  Note: AI annotations require human review before use in training.',
    ''
  );

  return `${output.join('\n')}\n`;
}

async function safeCreateRun(command: string): Promise<number | null> {
  try {
    return await createRun({command});
  } catch {
    return null;
  }
}

async function safeRecordLabelAssistRun(input: {
  runId: number | null;
  imagePath: string;
  classes: string[];
  savePath?: string;
  annotations: string[];
  notes: string[];
  tokensUsed: number;
}): Promise<void> {
  try {
    await recordLabelAssistRun(input);
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
