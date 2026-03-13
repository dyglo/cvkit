import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export async function getPackageVersion(): Promise<string> {
  const currentFilePath = fileURLToPath(import.meta.url);
  const packageJsonPath = path.resolve(path.dirname(currentFilePath), '../../package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {version?: string};

  return packageJson.version ?? '0.0.0';
}

