#!/usr/bin/env node
// Syntax-check extension sources and run the build validator (manifest file paths, sizes).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function walkJs(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJs(p, out);
    else if (ent.name.endsWith('.js') || ent.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const files = [
  ...walkJs(path.join(root, 'src')),
  ...walkJs(path.join(root, 'tests')),
  path.join(root, 'build.mjs'),
  path.join(root, 'scripts', 'lint.mjs'),
];

for (const file of files) {
  execSync(`node --check ${JSON.stringify(file)}`, { stdio: 'inherit' });
}

await import(pathToFileURL(path.join(root, 'build.mjs')).href);
console.log(`lint ok (${files.length} files checked, build validated)`);