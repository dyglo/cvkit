import {config as loadDotenv} from 'dotenv';

let envLoaded = false;

export function loadEnvFile(): void {
  if (envLoaded) {
    return;
  }

  loadDotenv({quiet: true});
  envLoaded = true;
}
