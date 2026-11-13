/**
 * Verifies the @researchhq/cli npm tarball metadata: `npm pack --dry-run`
 * packs dist/index.js and dist/bin.js and never leaks test/ or src/.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

interface PackResult {
  files?: Array<{ path: string }>;
}

describe('npm pack (cli)', { timeout: 180_000 }, () => {
  it('packs dist (including bin.js) and README, excluding test files', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: PKG_DIR,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const parsed = JSON.parse(out) as PackResult[];
    const paths = (parsed[0]?.files ?? []).map((f) => f.path);
    expect(paths).toContain('dist/index.js');
    expect(paths).toContain('dist/bin.js');
    expect(paths).toContain('README.md');
    expect(paths.some((p) => p.startsWith('test/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('src/'))).toBe(false);
  });
});
