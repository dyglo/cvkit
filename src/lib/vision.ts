import fs from 'fs';
import path from 'path';
import {readdir} from 'node:fs/promises';
import {isSupportedImagePath} from './image.js';

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

export async function callVision(
  prompt: string,
  imagePath: string,
  maxTokens = 1000
): Promise<string> {
  const {getOpenAIClient, VISION_MODEL} = await import('./openai.js');
  const base64 = readImageAsBase64(imagePath);
  const client = getOpenAIClient();
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
  return response.choices[0]?.message?.content ?? '';
}

export async function callStructuredVision<T>(input: {
  imagePath: string;
  prompt: string;
  maxTokens?: number;
}): Promise<{data: T; model: string; tokensUsed: number; rawText: string}> {
  const {getOpenAIClient, VISION_MODEL} = await import('./openai.js');
  const base64 = readImageAsBase64(input.imagePath);
  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model: VISION_MODEL,
    max_tokens: input.maxTokens ?? 1000,
    messages: [
      {
        role: 'user',
        content: [
          {type: 'text', text: input.prompt},
          {type: 'image_url', image_url: {url: base64}}
        ]
      }
    ]
  });
  const rawText = response.choices[0]?.message?.content ?? '';
  return {
    data: JSON.parse(sanitizeJsonText(rawText)) as T,
    model: response.model,
    tokensUsed: response.usage?.total_tokens ?? 0,
    rawText
  };
}

export async function listVisionImages(dirPath: string): Promise<string[]> {
  const resolvedDir = path.resolve(dirPath);
  const entries = await readdir(resolvedDir, {withFileTypes: true});
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(resolvedDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listVisionImages(fullPath)));
      continue;
    }

    if (entry.isFile() && isSupportedImagePath(fullPath)) {
      files.push(fullPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function sanitizeJsonText(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function readImageAsBase64(imagePath: string): string {
  try {
    return imageToBase64(imagePath);
  } catch (error: unknown) {
    if (isErrno(error, 'ENOENT')) {
      throw new Error(`Image not found: ${imagePath}`);
    }

    throw error;
  }
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
