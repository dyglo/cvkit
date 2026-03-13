import {stat} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type {ImageMetadata} from '../types/index.js';

const SUPPORTED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.bmp',
  '.tiff',
  '.webp',
  '.gif',
  '.avif'
]);

export async function inspectImage(imagePath: string): Promise<ImageMetadata> {
  const resolvedPath = path.resolve(imagePath);
  const extension = path.extname(resolvedPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported format: ${resolvedPath}`);
  }

  const fileInfo = await stat(resolvedPath).catch((error: unknown) => {
    if (isErrno(error, 'ENOENT')) {
      throw new Error(`File not found: ${imagePath}`);
    }

    throw error;
  });

  if (!fileInfo.isFile()) {
    throw new Error(`File not found: ${imagePath}`);
  }

  try {
    const metadata = await sharp(resolvedPath).metadata();
    if (!metadata.width || !metadata.height || !metadata.channels || !metadata.format) {
      throw new Error('Unsupported format');
    }

    return {
      fileName: path.basename(resolvedPath),
      format: metadata.format.toUpperCase(),
      width: metadata.width,
      height: metadata.height,
      channels: metadata.channels,
      channelLabel: describeChannels(metadata.channels, metadata.space),
      colorMode: normalizeColorMode(metadata.space),
      fileSizeBytes: fileInfo.size,
      hasAlpha: Boolean(metadata.hasAlpha),
      bitDepth: normalizeBitDepth(metadata.depth)
    };
  } catch (error: unknown) {
    if (error instanceof Error && /unsupported/i.test(error.message)) {
      throw new Error(`Unsupported format: ${imagePath}`);
    }

    throw new Error(`Corrupt or unreadable image: ${imagePath}`);
  }
}

export function isSupportedImagePath(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0];

  for (const currentUnit of units) {
    unit = currentUnit;
    if (value < 1024 || currentUnit === units.at(-1)) {
      break;
    }

    value /= 1024;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function describeChannels(channels: number, space?: string): string {
  if (channels === 1) {
    return 'Grayscale';
  }

  if (channels === 3) {
    return 'RGB';
  }

  void space;

  if (channels === 4) {
    return 'RGBA';
  }

  return `${channels} channels`;
}

function normalizeColorMode(space?: string): string {
  if (!space) {
    return 'unknown';
  }

  if (space === 'srgb') {
    return 'sRGB';
  }

  return space;
}

function normalizeBitDepth(depth?: string): string {
  switch (depth) {
    case 'uchar':
      return '8';
    case 'ushort':
      return '16';
    case 'float':
      return '32';
    default:
      return depth ?? 'unknown';
  }
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
