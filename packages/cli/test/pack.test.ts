/**
 * Verifies the @researchhq/cli npm tarball metadata: `npm pack --dry-run`
 * packs dist/index.js, dist/bin.js, README.md, LICENSE, and bundled
 * @researchhq/schema while never leaking test/, src/, or scripts/.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MONOREPO_ROOT = resolve(PKG_DIR, '..', '..');

interface PackResult {
  files?: Array<{ path: string }>;
}

describe('npm pack (cli)', { timeout: 180_000 }, () => {
  it('packs dist (including bin.js), README, LICENSE, and bundled schema while excluding test/src/scripts', () => {
    const sandbox = join(tmpdir(), `researchhq-cli-pack-test-${process.pid}`);
    rmSync(sandbox, { recursive: true, force: true });
    try {
      mkdirSync(join(sandbox, 'packages', 'cli'), { recursive: true });
      symlinkSync(join(MONOREPO_ROOT, 'node_modules'), join(sandbox, 'node_modules'));
      symlinkSync(join(MONOREPO_ROOT, 'tsconfig.base.json'), join(sandbox, 'tsconfig.base.json'));
      symlinkSync(join(MONOREPO_ROOT, 'packages', 'schema'), join(sandbox, 'packages', 'schema'));
      for (const entry of ['package.json', 'README.md', 'LICENSE', 'tsconfig.json', 'src', 'scripts', 'dist']) {
        const src = join(PKG_DIR, entry);
        if (existsSync(src)) {
          cpSync(src, join(sandbox, 'packages', 'cli', entry), { recursive: true });
        }
      }

      const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
        cwd: join(sandbox, 'packages', 'cli'),
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      });
      const parsed = JSON.parse(out) as PackResult[];
      const paths = (parsed[0]?.files ?? []).map((f) => f.path);
      expect(paths).toContain('dist/index.js');
      expect(paths).toContain('dist/bin.js');
      expect(paths).toContain('README.md');
      expect(paths).toContain('LICENSE');
      expect(paths).toContain('node_modules/@researchhq/schema/dist/index.js');
      expect(paths.some((p) => p.startsWith('test/'))).toBe(false);
      expect(paths.some((p) => p.startsWith('src/'))).toBe(false);
      expect(paths.some((p) => p.startsWith('scripts/'))).toBe(false);
      expect(existsSync(join(sandbox, 'packages', 'cli', 'node_modules'))).toBe(false);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
