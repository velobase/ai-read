import { createRequire } from 'node:module';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
const destination = new URL('../public/pdfjs/', import.meta.url);
await mkdir(destination, { recursive: true });
for (const entry of ['build/pdf.worker.min.mjs', 'cmaps', 'standard_fonts', 'wasm', 'LICENSE']) {
  await cp(path.join(root, entry), new URL(entry.replace('build/', ''), destination), {
    recursive: true,
  });
}
await writeFile(
  new URL('version.json', destination),
  JSON.stringify({ version: require('pdfjs-dist/package.json').version }),
);
