/**
 * Verifies the researchhq binary works through a node_modules-style symlink
 * (as created by `npm install -g` or `npx`), where process.argv[1] does NOT
 * end in 'bin.js'. This is the regression test for the CRITICAL-1 npx/symlink
 * invocation bug. Also covers --version, --help, per-subcommand --help, and
 * the init / add-idea / list-ideas / validate round trip.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const MONOREPO_ROOT = join(PKG_DIR, '..', '..');
const BIN_JS = join(PKG_DIR, 'dist', 'bin.js');
const TEST_ROOT = join(tmpdir(), `researchhq-bin-symlink-test-${process.pid}`);

if (!existsSync(BIN_JS)) {
  // Tests normally run after a build; recover for bare `vitest` invocations.
  execFileSync('npm', ['run', 'build', '-w', '@researchhq/schema'], {
    cwd: MONOREPO_ROOT,
    stdio: 'inherit',
  });
  execFileSync('npm', ['run', 'build', '-w', '@researchhq/cli'], {
    cwd: MONOREPO_ROOT,
    stdio: 'inherit',
  });
}

function makeSymlink(): string {
  const dir = join(TEST_ROOT, 'bin-symlink', String(process.pid));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const link = join(dir, 'researchhq');
  symlinkSync(BIN_JS, link);
  // Guard the premise of this regression test: argv[1] is a symlink path that
  // does not end in bin.js.
  expect(realpathSync(link)).toBe(realpathSync(BIN_JS));
  expect(link.endsWith('bin.js')).toBe(false);
  return link;
}

describe('researchhq binary via symlink', { timeout: 180_000 }, () => {
  it('prints the package version for --version and -v', () => {
    const link = makeSymlink();
    const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as {
      version?: string;
    };
    for (const flag of ['--version', '-v']) {
      const r = spawnSync('node', [link, flag], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(pkg.version ?? '');
    }
  });

  it('prints help and exits 0 for --help, -h, and <subcommand> --help', () => {
    const link = makeSymlink();
    for (const args of [['--help'], ['-h'], ['add-idea', '--help'], ['update-idea', '-h']]) {
      const r = spawnSync('node', [link, ...args], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Usage:');
      expect(r.stdout).toContain('researchhq list-ideas');
    }
  });

  it('rejects bad numeric flags without dumping a stack trace', () => {
    const link = makeSymlink();
    const dir = join(TEST_ROOT, 'bin-bad-number', String(process.pid));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    execFileSync('node', [link, 'init', '--dir', dir], { encoding: 'utf8' });
    const r = spawnSync('node', [link, 'update-idea', '--slug', 'x', '--readiness', '12abc', '--dir', dir], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("expects an integer, got '12abc'");
  });

  it('runs init, add-idea, list-ideas, and validate end to end', () => {
    const link = makeSymlink();
    const dir = join(TEST_ROOT, 'bin-e2e', String(process.pid));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const init = spawnSync('node', [link, 'init', '--dir', dir, '--name', 'Ada Lovelace'], {
      encoding: 'utf8',
    });
    expect(init.status).toBe(0);
    expect(existsSync(join(dir, 'researchhq.config.yaml'))).toBe(true);

    // init refuses to overwrite without --force, and succeeds with it.
    const refused = spawnSync('node', [link, 'init', '--dir', dir], { encoding: 'utf8' });
    expect(refused.status).not.toBe(0);
    const forced = spawnSync('node', [link, 'init', '--dir', dir, '--force'], { encoding: 'utf8' });
    expect(forced.status).toBe(0);

    const add = spawnSync(
      'node',
      [link, 'add-idea', '--slug', 'bin-test-paper', '--title', 'Added through the symlinked binary', '--dir', dir],
      { encoding: 'utf8' },
    );
    expect(add.status).toBe(0);
    expect(add.stdout).toContain("Added planned paper 'bin-test-paper'");

    const list = spawnSync('node', [link, 'list-ideas', '--dir', dir], { encoding: 'utf8' });
    expect(list.status).toBe(0);
    expect(list.stdout).toContain('bin-test-paper');

    const validate = spawnSync('node', [link, 'validate', '--dir', dir], { encoding: 'utf8' });
    expect(validate.status).toBe(0);
    expect(validate.stdout).toContain('All checks passed');
  });
});
