import {defineConfig} from 'tsup';

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['esm'],
  outDir: 'dist',
  target: 'node18',
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  external: ['sharp'],
  banner: {
    js: '#!/usr/bin/env node'
  }
});
