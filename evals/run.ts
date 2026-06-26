/**
 * Governance regression eval runner.
 *
 * Run from the repo root via the "eval" script:  tsx evals/run.ts
 *
 * Pipeline:
 *   1. Discover every evals/cases/<*>.json file.
 *   2. Parse + validate each file against the EvalCase schema (zod).
 *   3. Run each case's input through the TARGET function.
 *   4. Assert the reply against the case's expectations.
 *   5. Print a summary table and exit non-zero on any structural error
 *      (invalid JSON / schema violation) or — once the real target is wired —
 *      any failing case.
 *
 * Phase 0: the TARGET is a STUB that returns a fixed "escalated" result so the
 * harness exercises the whole load -> validate -> run -> assert pipeline
 * end-to-end without depending on any @vta/* package.
 *
 * Phase 1: replace the stub with an adapter over the real TeachingService
 * (see `makeTarget` below) to turn this suite into a CI gate for refusals,
 * injection resistance, grounding/citation, and no-leak guarantees.
 *
 * Dependency-light by design: only `zod` plus the Node stdlib.
 */

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";

import type { z } from "zod";

import {
  EvalCaseFile,
  type EvalCase,
  type EvalInput,
  type EvalResult,
  type EvalTarget,
  type TargetReply,
} from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, "cases");

// ---------------------------------------------------------------------------
// TARGET
// ---------------------------------------------------------------------------

/**
 * Build the function under test.
 *
 * PHASE 0 STUB: returns a fixed "escalated" reply for every input. This is
 * intentionally a placeholder so the harness runs end-to-end. With the stub,
 * cases whose expected status is not "escalated" will report as failing — that
 * is expected in Phase 0 and does not, on its own, fail the process. Only
 * structural errors (bad JSON / schema violations) fail the build in Phase 0.
 *
 * TODO(phase-1): replace this stub with a real adapter, e.g.
 *
 *   import { TeachingService } from "@vta/teaching";
 *   const svc = await TeachingService.create(...);
 *   return async (input) => {
 *     const reply = await svc.handle(toInboundRequest(input));
 *     return {
 *       status: reply.status,                       // map ReplyStatus -> EvalStatus
 *       text: reply.text,
 *       citationCount: reply.citations.length,
 *       refuseReason: reply.refuseReason,           // from the governance rule that fired
 *     };
 *   };
 *
 * Once wired, flip FAIL_ON_CASE_FAILURE (below) to true so failing cases gate CI.
 */
function makeTarget(): EvalTarget {
  return async (_input: EvalInput): Promise<TargetReply> => {
    return {
      status: "escalated",
      text: "[stub] Phase-0 placeholder target: escalating to a human.",
      citationCount: 0,
    };
  };
}

/**
 * Phase 0: only structural errors fail the process; case assertion failures are
 * reported but tolerated (the stub cannot satisfy real expectations yet).
 *
 * TODO(phase-1): set to `true` so any failing case fails CI.
 */
const FAIL_ON_CASE_FAILURE = false;

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/**
 * Evaluate one case's reply against its expectations.
 */
function assertCase(c: EvalCase, reply: TargetReply): EvalResult {
  const fail = (detail: string): EvalResult => ({ caseId: c.id, passed: false, detail });

  // Status is the primary assertion.
  if (reply.status !== c.expect.status) {
    return fail(`expected status "${c.expect.status}" but got "${reply.status}"`);
  }

  // Citation requirement (only meaningful for answered replies).
  if (c.expect.mustCite === true && reply.citationCount < 1) {
    return fail("expected at least one citation but reply had none");
  }

  // Forbidden substrings (case-insensitive) — leak / disallowed-content checks.
  if (c.expect.mustNotContain && c.expect.mustNotContain.length > 0) {
    const haystack = reply.text.toLowerCase();
    for (const needle of c.expect.mustNotContain) {
      if (haystack.includes(needle.toLowerCase())) {
        return fail(`reply contained forbidden substring: ${JSON.stringify(needle)}`);
      }
    }
  }

  // Refusal reason code (only when the case asserts one).
  if (c.expect.mustRefuseReason !== undefined) {
    if (reply.refuseReason !== c.expect.mustRefuseReason) {
      return fail(
        `expected refuse reason "${c.expect.mustRefuseReason}" but got ` +
          `"${reply.refuseReason ?? "<none>"}"`,
      );
    }
  }

  return { caseId: c.id, passed: true, detail: "ok" };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

interface LoadedFile {
  /** File name (basename) for diagnostics. */
  file: string;
  /** Validated cases. */
  cases: EvalCase[];
}

/**
 * A structural error: a case file that could not be read, parsed, or validated.
 * These always fail the process (Phase 0 and Phase 1).
 */
class StructuralError extends Error {}

/**
 * Discover and validate all case files. Throws StructuralError on the first
 * malformed file (with a readable message including the zod issue path).
 */
async function loadCases(): Promise<LoadedFile[]> {
  let entries: string[];
  try {
    entries = await readdir(CASES_DIR);
  } catch (cause) {
    throw new StructuralError(
      `could not read cases directory ${CASES_DIR}: ${describe(cause)}`,
    );
  }

  const jsonFiles = entries.filter((f) => f.toLowerCase().endsWith(".json")).sort();
  if (jsonFiles.length === 0) {
    throw new StructuralError(`no *.json case files found in ${CASES_DIR}`);
  }

  const loaded: LoadedFile[] = [];
  const seenIds = new Set<string>();

  for (const file of jsonFiles) {
    const fullPath = join(CASES_DIR, file);

    let raw: string;
    try {
      raw = await readFile(fullPath, "utf8");
    } catch (cause) {
      throw new StructuralError(`could not read ${file}: ${describe(cause)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new StructuralError(`invalid JSON in ${file}: ${describe(cause)}`);
    }

    const result = EvalCaseFile.safeParse(parsed);
    if (!result.success) {
      throw new StructuralError(
        `schema validation failed for ${file}:\n${formatZodError(result.error)}`,
      );
    }

    for (const c of result.data) {
      if (seenIds.has(c.id)) {
        throw new StructuralError(`duplicate case id "${c.id}" (in ${file})`);
      }
      seenIds.add(c.id);
    }

    loaded.push({ file, cases: result.data });
  }

  return loaded;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function describe(value: unknown): string {
  if (value instanceof Error) return value.message;
  return String(value);
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `  - ${path}: ${issue.message}`;
    })
    .join("\n");
}

/**
 * Render a compact summary table of results.
 */
function printSummary(results: EvalResult[]): void {
  const idWidth = Math.max(2, ...results.map((r) => r.caseId.length));
  const header = `${pad("ID", idWidth)}  RESULT  DETAIL`;
  const rule = "-".repeat(header.length);

   
  console.log(rule);
   
  console.log(header);
   
  console.log(rule);
  for (const r of results) {
    const mark = r.passed ? "PASS  " : "FAIL  ";
     
    console.log(`${pad(r.caseId, idWidth)}  ${mark}  ${r.detail}`);
  }
   
  console.log(rule);
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  // Minimal arg handling: support a --help flag and ignore everything else so
  // the script stays dependency-light. Filtering by id can be added in Phase 1.
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
     
    console.log(
      [
        "Usage: tsx evals/run.ts",
        "",
        "Loads evals/cases/*.json, validates them against the EvalCase schema,",
        "and runs each case through the target function.",
        "",
        "Phase 0 uses a stub target; case assertion failures are tolerated but",
        "structural errors (bad JSON / schema) exit non-zero.",
      ].join("\n"),
    );
    return 0;
  }

  let loaded: LoadedFile[];
  try {
    loaded = await loadCases();
  } catch (err) {
    if (err instanceof StructuralError) {
       
      console.error(`\nSTRUCTURAL ERROR: ${err.message}\n`);
      return 2;
    }
    throw err;
  }

  const target = makeTarget();
  const results: EvalResult[] = [];

  for (const { file, cases } of loaded) {
    for (const c of cases) {
      let reply: TargetReply;
      try {
        reply = await target(c.input);
      } catch (cause) {
        // A target throwing is treated as a (non-structural) case failure.
        results.push({
          caseId: c.id,
          passed: false,
          detail: `target threw while handling case (from ${file}): ${describe(cause)}`,
        });
        continue;
      }
      results.push(assertCase(c, reply));
    }
  }

  printSummary(results);

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

   
  console.log(`\n${passed}/${total} cases passed (${failed} failed).`);

  if (FAIL_ON_CASE_FAILURE && failed > 0) {
     
    console.error("Failing because one or more cases did not pass.");
    return 1;
  }

  if (!FAIL_ON_CASE_FAILURE && failed > 0) {
     
    console.log(
      "\nNote (Phase 0): case failures above are tolerated because the target " +
        "is a stub. Wire the real TeachingService and flip FAIL_ON_CASE_FAILURE " +
        "to make these gate CI.",
    );
  }

  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    // Unexpected error: surface it and fail hard.
     
    console.error("UNEXPECTED ERROR:", err instanceof Error ? err.stack ?? err.message : err);
    process.exitCode = 2;
  },
);
