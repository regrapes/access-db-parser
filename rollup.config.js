import path from 'path'

import typescript from '@rollup/plugin-typescript'
import { defineConfig } from 'rollup'

export default defineConfig({
  input: 'src/index.ts',
  output: [
    {
      dir: 'build',
      entryFileNames: '[name].esm.js',
      format: 'esm',
      sourcemap: true,
    },
    {
      dir: 'build',
      entryFileNames: '[name].cjs.js',
      format: 'cjs',
      sourcemap: true,
    },
  ],
  external: id => !(id.startsWith('.') || path.isAbsolute(id)),
  plugins: [typescript()],
})
