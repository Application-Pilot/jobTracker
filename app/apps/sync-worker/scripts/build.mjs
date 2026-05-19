import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const execFileAsync = promisify(execFile);
const distDir = new URL('../dist/', import.meta.url);

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../dist/index.js', import.meta.url)),
  bundle: true,
  minify: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
});

await execFileAsync('zip', ['-j', 'worker.zip', 'index.js'], {
  cwd: distDir,
});
