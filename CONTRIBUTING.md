# Contributing

Thanks for contributing to the Virtual Teaching Assistant (VTA). This repository
follows a small set of strict conventions that keep the all-TypeScript pnpm
monorepo coherent. Please read these before opening a pull request.

## Language

All committed source — code, comments, and these top-level docs — is written in
**English**. Conversational and design documents may be in Chinese.

## TypeScript and module conventions

- **ESM everywhere.** Every `package.json` sets `"type": "module"`. There is no
  CommonJS in this repo.
- **NodeNext resolution.** `module` and `moduleResolution` are both `NodeNext`.
  As a direct consequence, **relative imports must carry an explicit `.js`
  extension**, even though the source file is `.ts`:

  ```ts
  import { loadConfig } from "./env.js";        // ✅ correct
  import { loadConfig } from "./env";           // ❌ will not resolve
  ```

  Cross-package imports use the package name:

  ```ts
  import { VtaError } from "@vta/shared";        // ✅ correct
  import { VtaError } from "../../shared/src";   // ❌ never reach across packages
  ```

- **`strict` and `noUncheckedIndexedAccess` are on.** Guard every array/object
  index access; a lookup may be `undefined`. No implicit `any`. Handle the
  `undefined` case explicitly rather than asserting it away.

  ```ts
  const first = items[0];
  if (first === undefined) {
    // handle the empty case
  }
  ```

- **`isolatedModules` is on.** Use `import type` / `export type` for anything
  used only as a type, so each file can be transpiled in isolation:

  ```ts
  import type { CourseId, InboundRequest } from "@vta/shared";
  export type { OutboundReply } from "./reply.js";
  ```

## Package boundaries

These boundaries are **structural rules**, not style suggestions:

- **`@vta/shared` has no `@vta` dependencies.** It is the leaf everyone else
  depends on; it must not depend on any other workspace package.
- **Only `@vta/llm` may name a concrete model.** No other package mentions
  DeepSeek, GPT, Codex, or any model identifier. Everyone else asks for a
  logical role (`agent.primary`, `agent.fallback`, `embed`, `rerank`,
  `guard.judge`).
- **All DB access is course-scoped.** Every tenant-owned query is filtered by
  `course_id`. `@vta/data` exposes course-scoped access; do not add an
  unscoped read/write path.
- **Pi usage is isolated.** All use of the Pi agent harness lives behind a
  single adapter file, with a `TODO` to verify the upstream package name and
  version at install time.

## Versions

Use the exact dependency ranges already pinned across the workspace (e.g.
`drizzle-orm ^0.38.2`, `zod ^3.24.1`, `pino ^9.5.0`, `bullmq ^5.34.5`,
`ioredis ^5.4.2`, `openai ^4.77.0`). Do not introduce a divergent range for a
dependency another package already uses — all packages must agree.

## Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <description>
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`.
Examples:

```
feat(llm): add role resolution for guard.judge
fix(data): scope attachment query by course_id
docs(architecture): clarify egress rails ordering
```

## How to add a package

1. Create `packages/<name>/` with a `src/` directory and an `index.ts` entry
   point.
2. Add `packages/<name>/package.json`:

   ```json
   {
     "name": "@vta/<name>",
     "version": "0.0.0",
     "private": true,
     "type": "module",
     "main": "./dist/index.js",
     "types": "./dist/index.d.ts",
     "exports": {
       ".": {
         "types": "./dist/index.d.ts",
         "default": "./dist/index.js"
       }
     },
     "scripts": {
       "build": "tsc -p tsconfig.json",
       "typecheck": "tsc -p tsconfig.json --noEmit",
       "clean": "rimraf dist *.tsbuildinfo"
     },
     "devDependencies": {
       "rimraf": "^6.0.1"
     }
   }
   ```

3. Add `packages/<name>/tsconfig.json`:

   ```json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": {
       "outDir": "dist",
       "rootDir": "src"
     },
     "include": ["src"]
   }
   ```

4. If the package needs shared primitives, add the workspace dependency:

   ```json
   "dependencies": {
     "@vta/shared": "workspace:*"
   }
   ```

5. Respect the boundaries above (no model names outside `@vta/llm`, course-scope
   all DB access, `@vta/shared` stays dependency-free).

## Before you open a PR

```bash
pnpm build
pnpm typecheck && pnpm test
pnpm lint
```

Keep changes scoped to one concern per PR where practical, and reference the
phase (Phase 0 / Phase 1) the change targets.
