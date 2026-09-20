import { readdir } from "node:fs/promises";
import { join } from "node:path";

const roots = ["test", join("test", "contract")];
const files = (
  await Promise.all(roots.map(async (root) =>
    (await readdir(root))
      .filter((name) => name.endsWith(".test.mts"))
      .map((name) => join(root, name))))
).flat().sort();

for (const file of files) {
  const child = Bun.spawn([process.execPath, file], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${file} failed with exit code ${exitCode}`);
  }
}

console.log(`OK: ${files.length} permanent regression scripts passed`);
