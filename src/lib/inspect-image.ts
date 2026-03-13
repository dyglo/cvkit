import {stat} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export interface ImageInspectionReport {
  path: string;
  fileName: string;
  format: string;
  fileSizeBytes: number;
  width: number;
  height: number;
  channels: number;
  colorMode: string;
}

export async function inspectImage(inputPath: string): Promise<ImageInspectionReport> {
  const resolvedPath = path.resolve(inputPath);
  const fileStat = await stat(resolvedPath).catch((error: unknown) => {
    if (isMissingFileError(error)) {
      throw new Error(`Image not found: ${resolvedPath}`);
    }

    throw error;
  });

  if (fileStat.isDirectory()) {
    throw new Error(`Expected an image file but received a directory: ${resolvedPath}`);
  }

  try {
    const metadata = await sharp(resolvedPath).metadata();

    if (!metadata.width || !metadata.height || !metadata.channels || !metadata.format) {
      throw new Error(`Unsupported or unreadable image file: ${resolvedPath}`);
    }

    return {
      path: resolvedPath,
      fileName: path.basename(resolvedPath),
      format: metadata.format,
      fileSizeBytes: fileStat.size,
      width: metadata.width,
      height: metadata.height,
      channels: metadata.channels,
      colorMode: metadata.space ?? 'unknown'
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('Unsupported or unreadable image file')) {
      throw error;
    }

    if (error instanceof Error && /Input file contains unsupported image format/i.test(error.message)) {
      throw new Error(`Unsupported image format: ${resolvedPath}`);
    }

    if (error instanceof Error && /corrupt|unsupported|bad seek|invalid/i.test(error.message)) {
      throw new Error(`Corrupt or unreadable image file: ${resolvedPath}`);
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}
