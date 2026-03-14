import {defineConfig} from 'tsup';

export default defineConfig({
  entry: ['src/index.tsx', 'src/server.ts'],
  format: ['esm'],
  outDir: 'dist',
  target: 'node20',
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  external: ['sharp'],
  banner: {
    js: '#!/usr/bin/env node'
  }
});
