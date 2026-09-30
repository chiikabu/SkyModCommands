// Bundles the game into a single self-contained HTML file (dist/index.html).
// Usage: node tools/build.mjs [--watch] [--dev]
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev') || watch;

async function buildOnce() {
  const t0 = Date.now();
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/main.js')],
    bundle: true,
    format: 'iife',
    minify: !dev,
    sourcemap: false,
    write: false,
    target: ['es2020'],
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
    logLevel: 'warning',
  });
  const js = result.outputFiles[0].text;
  const css = fs.readFileSync(path.join(root, 'src/ui/style.css'), 'utf8');
  let html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  // Inline CSS + JS. Escape closing script tags inside the bundle.
  html = html.replace('/*__CSS__*/', () => css);
  html = html.replace('/*__JS__*/', () => js.replace(/<\/script/gi, '<\\/script'));
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/index.html'), html);
  // Artifact variant: no doctype/html/head/body wrapper (the host supplies the skeleton + viewport meta)
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta[^>]*>\s*/g, '');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  fs.writeFileSync(path.join(root, 'dist/artifact.html'), head.trim() + '\n' + body.trim() + '\n');
  console.log(`built dist/index.html  ${(html.length / 1024).toFixed(0)} KB  in ${Date.now() - t0} ms`);
}

if (watch) {
  await buildOnce();
  let timer = null;
  fs.watch(path.join(root, 'src'), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => buildOnce().catch((e) => console.error(e.message)), 120);
  });
  console.log('watching src/ ...');
} else {
  await buildOnce();
}
