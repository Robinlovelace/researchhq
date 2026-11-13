#!/usr/bin/env node
/**
 * Stages @researchhq/schema inside packages/cli/node_modules/@researchhq/schema
 * during `npm pack` / `npm publish` so `bundleDependencies` includes the built
 * workspace package, then cleans up in `postpack` so workspace symlink
 * resolution stays untouched during development.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaDir = resolve(cliDir, '..', 'schema');
const targetNodeModules = join(cliDir, 'node_modules');
const targetSchemaDir = join(targetNodeModules, '@researchhq', 'schema');

const mode = process.argv[2];

if (mode === 'stage') {
  if (!existsSync(join(schemaDir, 'package.json'))) {
    process.exit(0);
  }
  if (!existsSync(join(schemaDir, 'dist', 'index.js'))) {
    execFileSync('npm', ['run', 'build'], { cwd: schemaDir, stdio: 'inherit' });
  }
  rmSync(targetSchemaDir, { recursive: true, force: true });
  mkdirSync(targetSchemaDir, { recursive: true });
  for (const entry of ['package.json', 'README.md', 'LICENSE', 'dist']) {
    const src = join(schemaDir, entry);
    if (existsSync(src)) {
      cpSync(src, join(targetSchemaDir, entry), { recursive: true });
    }
  }
} else if (mode === 'clean') {
  rmSync(targetNodeModules, { recursive: true, force: true });
} else {
  console.error(`Usage: stage-bundled-schema.mjs <stage|clean>`);
  process.exit(1);
}
