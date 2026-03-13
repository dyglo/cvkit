import {mkdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {ConfigValues} from '../types/index.js';

const SECRET_KEY_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD)/i;

export function getConfigDir(): string {
  return path.join(os.homedir(), '.cvkit');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

export async function readConfig(): Promise<ConfigValues> {
  try {
    const raw = await readFile(getConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid config file format.');
    }

    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, String(value)])
    );
  } catch (error: unknown) {
    if (isErrno(error, 'ENOENT')) {
      return {};
    }

    throw error;
  }
}

export async function setConfigValue(key: string, value: string): Promise<void> {
  const existing = await readConfig();
  existing[key] = value;
  await mkdir(getConfigDir(), {recursive: true});
  await writeFile(getConfigPath(), `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
}

export function maskConfigValue(key: string, value: string): string {
  if (!SECRET_KEY_PATTERN.test(key)) {
    return value;
  }

  if (value.length <= 4) {
    return '*'.repeat(value.length);
  }

  if (value.length <= 8) {
    return `${value.slice(0, 1)}${'*'.repeat(value.length - 2)}${value.slice(-1)}`;
  }

  return `${value.slice(0, 2)}${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`;
}

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
