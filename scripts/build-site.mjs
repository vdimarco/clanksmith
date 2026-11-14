// Copy the board page into the site, so one static folder serves both
// clanksmith.com/ and clanksmith.com/board/. `--check` only compares.
import { cpSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "board", "public");
const to = join(root, "site", "board");

const files = (dir, base = dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path, base) : [path.slice(base.length + 1)];
}).sort();

if (process.argv.includes("--check")) {
  const want = files(from);
  let have = [];
  try { have = files(to); } catch { /* missing folder fails below */ }
  const same = JSON.stringify(want) === JSON.stringify(have)
    && want.every((f) => readFileSync(join(from, f)).equals(readFileSync(join(to, f))));
  if (!same) {
    console.error("site/board is not a copy of board/public. Run: node scripts/build-site.mjs");
    process.exit(1);
  }
  console.log(`ok   site/board matches board/public · ${want.length} files`);
} else {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log(`copied ${files(to).length} files to site/board`);
}
