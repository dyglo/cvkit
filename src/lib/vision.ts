import fs from 'node:fs';
import {readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {getOpenAIClient, normalizeOpenAIError, VISION_MODEL} from './openai.js';

const SUPPORTED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] as const;
const SUPPORTED_FORMATS_LABEL = SUPPORTED_IMAGE_EXTENSIONS.join(', ');

export type VisionCompletionResult<T> = {
  data: T;
  model: string;
  tokensUsed: number;
};

export function imageToBase64(imagePath: string): string {
  const ext = path.extname(imagePath).slice(1).toLowerCase();
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp'
  };
  const mime = mimeMap[ext] ?? 'image/jpeg';
  const data = fs.readFileSync(imagePath).toString('base64');
  return `data:${mime};base64,${data}`;
}

export async function resolveVisionImage(imagePath: string): Promise<string> {
  const resolvedPath = path.resolve(imagePath);
  const fileInfo = await stat(resolvedPath).catch((error: unknown) => {
    if (isErrno(error, 'ENOENT')) {
      throw new Error(`Image not found: ${imagePath}`);
    }

    throw error;
  });

  if (!fileInfo.isFile()) {
    throw new Error(`Image not found: ${imagePath}`);
  }

  if (!isSupportedVisionImage(resolvedPath)) {
    throw new Error(`Unsupported format: ${imagePath}. Supported formats: ${SUPPORTED_FORMATS_LABEL}`);
  }

  return resolvedPath;
}

export async function listVisionImages(dirPath: string): Promise<string[]> {
  const resolvedDir = path.resolve(dirPath);
  const dirInfo = await stat(resolvedDir).catch((error: unknown) => {
    if (isErrno(error, 'ENOENT')) {
      throw new Error(`Directory not found: ${dirPath}`);
    }

    throw error;
  });

  if (!dirInfo.isDirectory()) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  const entries = await readdir(resolvedDir, {withFileTypes: true});
  const images = entries
    .filter((entry) => entry.isFile() && isSupportedVisionImage(entry.name))
    .map((entry) => path.join(resolvedDir, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));

  if (images.length === 0) {
    throw new Error(`No supported images found in ${dirPath}. Supported formats: ${SUPPORTED_FORMATS_LABEL}`);
  }

  return images;
}

export async function callStructuredVision<T>({
  imagePath,
  prompt,
  maxTokens = 1000
}: {
  imagePath: string;
  prompt: string;
  maxTokens?: number;
}): Promise<VisionCompletionResult<T>> {
  const resolvedImage = await resolveVisionImage(imagePath);
  const client = await getOpenAIClient();
  const base64 = imageToBase64(resolvedImage);

  try {
    const response = await client.chat.completions.create({
      model: VISION_MODEL,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            {type: 'text', text: prompt},
            {type: 'image_url', image_url: {url: base64}}
          ]
        }
      ]
    });

    const content = extractMessageText(response.choices[0]?.message?.content);
    if (!content) {
      throw new Error('Empty response from model');
    }

    return {
      data: parseStructuredJson<T>(content),
      model: response.model ?? VISION_MODEL,
      tokensUsed: response.usage?.total_tokens ?? 0
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('OpenAI API error:')) {
      throw error;
    }

    if (error instanceof Error && error.message.startsWith('Failed to parse model output:')) {
      throw normalizeOpenAIError(error);
    }

    throw normalizeOpenAIError(error);
  }
}

export function isSupportedVisionImage(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return SUPPORTED_IMAGE_EXTENSIONS.includes(ext as (typeof SUPPORTED_IMAGE_EXTENSIONS)[number]);
}

export function getSupportedVisionFormatsLabel(): string {
  return SUPPORTED_FORMATS_LABEL;
}

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return '';
        }

        if ('type' in item && item.type === 'text' && 'text' in item && typeof item.text === 'string') {
          return item.text;
        }

        return '';
      })
      .join('\n')
      .trim();
  }

  return '';
}

function parseStructuredJson<T>(content: string): T {
  const normalized = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');

  try {
    return JSON.parse(normalized) as T;
  } catch {
    throw new Error('Failed to parse model output: expected JSON');
  }
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
