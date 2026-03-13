import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {maskSecretValue, shouldMaskKey} from './secrets.js';

export type ConfigValues = Record<string, string>;

function getConfigDirectory(): string {
  return path.join(os.homedir(), '.cvkit');
}

export class ConfigStore {
  readonly directoryPath = getConfigDirectory();
  readonly filePath = path.join(this.directoryPath, 'config.json');

  async set(key: string, value: string): Promise<void> {
    const current = await this.read();
    current[key] = value;
    await this.write(current);
  }

  async list(): Promise<ConfigValues> {
    return this.read();
  }

  async listMasked(): Promise<ConfigValues> {
    const values = await this.read();
    return Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        shouldMaskKey(key) ? maskSecretValue(value) : value
      ])
    );
  }

  private async read(): Promise<ConfigValues> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content) as unknown;

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Config file is invalid: ${this.filePath}`);
      }

      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, String(value)])
      );
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return {};
      }

      throw error;
    }
  }

  private async write(values: ConfigValues): Promise<void> {
    await mkdir(this.directoryPath, {recursive: true});
    const tempPath = `${this.filePath}.tmp`;
    const content = `${JSON.stringify(values, null, 2)}\n`;

    await writeFile(tempPath, content, 'utf8');
    await rm(this.filePath, {force: true});
    await rename(tempPath, this.filePath);
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}
