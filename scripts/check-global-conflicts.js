#!/usr/bin/env node

/**
 * Pre-link check: detects globally installed packages whose bin name
 * conflicts with this package's "merlin" bin.
 *
 * If a conflicting package is found, prints removal instructions and exits 1
 * so that `pnpm link --global` is NOT run on top of a stale shim.
 */

import { execSync } from 'child_process';

const OUR_PACKAGE = '@thedeltalab/merlin';
const BIN_NAME = 'merlin';

try {
  const output = execSync('pnpm list -g --depth 0 --json', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const parsed = JSON.parse(output);
  // pnpm list -g --json returns an array with one entry
  const deps = parsed[0]?.dependencies ?? {};

  const conflicts = Object.keys(deps).filter((name) => {
    // Another package that is NOT us but occupies the same bin name.
    // The old unscoped "merlin" package is the typical offender.
    return name !== OUR_PACKAGE && name.toLowerCase().includes('merlin');
  });

  if (conflicts.length > 0) {
    console.error(
      `\n❌ Global bin conflict detected!\n` +
      `\n` +
      `The following globally-installed package(s) also provide a "merlin" binary:\n` +
      conflicts.map((c) => `  - ${c} (${deps[c].version})`).join('\n') +
      `\n\n` +
      `This will shadow the new @thedeltalab/merlin binary.\n` +
      `Remove them first:\n\n` +
      `  pnpm remove -g ${conflicts.join(' ')}\n\n` +
      `Then re-run:\n\n` +
      `  pnpm link:global\n`
    );
    process.exit(1);
  }
} catch (err) {
  // If pnpm list fails (e.g. no global packages), that's fine — no conflicts.
  if (err?.status === 1) {
    // pnpm exits 1 when global dir is empty; not a real error
  } else {
    // Unexpected error — warn but don't block
    console.warn('⚠ Could not check global packages for conflicts:', err.message);
  }
}
