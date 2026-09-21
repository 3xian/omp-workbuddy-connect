import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";

const roots = ["test", join("test", "contract")];
const files = (
  await Promise.all(roots.map(async (root) =>
    (await readdir(root))
      .filter((name) => name.endsWith(".test.mts"))
      .map((name) => join(root, name))))
).flat().sort();

// Every script is classified explicitly. A new regression must opt into the
// parallel lane rather than silently acquiring concurrency.
const parallelNames = new Set([
  "auth.test.mts",
  "before-provider-request-runtime.test.mts",
  "dual-realm-isolation.test.mts",
  "model-catalog.test.mts",
  "model-scope-lifecycle.test.mts",
  "model-transport.test.mts",
  "payload.test.mts",
  "persisted-credential-restart.test.mts",
  "provider-logout.test.mts",
  "provider.test.mts",
  "request-identity-binding.test.mts",
  "scope.test.mts",
  "settings.test.mts",
  "tool-loop.test.mts",
  "ui.test.mts",
]);

// These scripts contain wall-clock assertions, host timeout checks, or nested
// Task subprocesses. Keep them serial even though every script has its own Bun
// process; process isolation does not remove scheduler and resource contention.
const serialNames = new Set([
  "credits.test.mts",
  "native-transport.test.mts",
  "oauth-protocol.test.mts",
  "session-start.test.mts",
  "task-runtime-contract.test.mts",
]);

const discoveredNames = files.map((file) => basename(file));
const duplicateNames = discoveredNames.filter((name, index) => discoveredNames.indexOf(name) !== index);
const classifiedNames = new Set([...parallelNames, ...serialNames]);
const unclassified = discoveredNames.filter((name) => !classifiedNames.has(name));
const missing = [...classifiedNames].filter((name) => !discoveredNames.includes(name));
if (duplicateNames.length > 0 || unclassified.length > 0 || missing.length > 0) {
  throw new Error(
    `invalid fast-runner classification: duplicates=[${duplicateNames.join(", ")}] `
      + `unclassified=[${unclassified.join(", ")}] missing=[${missing.join(", ")}]`,
  );
}
const parallel = files.filter((file) => parallelNames.has(basename(file)));
const serial = files.filter((file) => serialNames.has(basename(file)));

const requestedConcurrency = process.env.WORKBUDDY_TEST_CONCURRENCY;
const parsedConcurrency = requestedConcurrency === undefined ? 4 : Number(requestedConcurrency);
if (!Number.isInteger(parsedConcurrency) || parsedConcurrency < 1) {
  throw new Error(`WORKBUDDY_TEST_CONCURRENCY must be a positive integer, received ${requestedConcurrency}`);
}
const concurrency = Math.min(parsedConcurrency, Math.max(1, parallel.length));

interface Result {
  file: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function run(file: string): Promise<Result> {
  const child = Bun.spawn([process.execPath, file], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { file, exitCode, stdout, stderr };
}

async function runConcurrent(batch: readonly string[], limit: number): Promise<Result[]> {
  const results = new Array<Result>(batch.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, batch.length) }, async () => {
    while (next < batch.length) {
      const index = next;
      next += 1;
      results[index] = await run(batch[index]!);
    }
  }));
  return results;
}

function print(result: Result, lane: "parallel" | "serial"): void {
  process.stdout.write(`\n[${lane}] ${result.file}\n`);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}

console.log(
  `Running ${parallel.length} parallel-safe scripts at concurrency ${concurrency}, then ${serial.length} sensitive scripts serially`,
);
const startedAt = Date.now();
const results = await runConcurrent(parallel, concurrency);
for (const result of results) print(result, "parallel");
for (const file of serial) {
  const result = await run(file);
  results.push(result);
  print(result, "serial");
}

const failures = results.filter((result) => result.exitCode !== 0);
if (failures.length > 0) {
  throw new Error(
    `${failures.length}/${files.length} permanent regression scripts failed: ${
      failures.map((failure) => `${failure.file} (exit ${failure.exitCode})`).join(", ")
    }`,
  );
}

const elapsedMs = Date.now() - startedAt;
console.log(`OK: ${files.length} permanent regression scripts passed in ${elapsedMs}ms using the hybrid fast runner`);
