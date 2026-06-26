import { defineConfig } from 'vitest/config';

// Root Vitest configuration for the Virtual Teaching Assistant monorepo.
// Individual packages may add their own vitest.config.ts later if they need
// package-specific setup; this root config collects tests across all packages.
export default defineConfig({
  test: {
    // Pure Node environment — no DOM. All packages here are server/CLI side.
    environment: 'node',
    // Collect unit/spec tests from every workspace package.
    include: ['packages/**/*.{test,spec}.ts'],
    // Don't fail the run when a package has no tests yet (Phase 0 scaffold).
    passWithNoTests: true,
    coverage: {
      // v8 coverage is built into Node and needs no extra native deps.
      provider: 'v8',
      reporter: ['text', 'html'],
      // Coverage is opt-in (run with `vitest --coverage`); these are the
      // defaults applied when it is enabled.
      reportsDirectory: './coverage',
      include: ['packages/**/src/**/*.ts'],
      exclude: ['packages/**/dist/**', 'packages/**/*.{test,spec}.ts'],
    },
  },
});
