import {defineConfig} from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: 'dist',
  target: 'node18',
  banner: {
    js: '#!/usr/bin/env node'
  }
});

