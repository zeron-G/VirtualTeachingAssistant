// @ts-check
// ESLint v9 flat config for the Virtual Teaching Assistant monorepo.
// Uses typescript-eslint's helper to compose ESLint + TS recommended rule sets.
//
// Pragmatic by design: we intentionally avoid type-checked lint rules
// (tseslint.configs.recommendedTypeChecked) because they require a project
// service / parserOptions.project, which adds CI friction and slows linting
// across a multi-package workspace. Type correctness is enforced separately
// via `pnpm run typecheck` (tsc --noEmit) per package.

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Global ignores — applied to all configs below.
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/drizzle/**',
    ],
  },

  // Base ESLint recommended rules.
  eslint.configs.recommended,

  // typescript-eslint recommended rules (non type-checked).
  ...tseslint.configs.recommended,

  // Project-wide language options: ESM + Node globals.
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Allow intentionally-unused args/vars when prefixed with `_`.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Prefer `import type` for type-only imports (works well with isolatedModules).
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },

  // Allow CommonJS-style globals / relaxed rules in config files themselves.
  {
    files: ['**/*.config.{js,mjs,cjs,ts}', '**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
