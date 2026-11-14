// The published site is the v3 page in site/. It does not include the board.
// `--check` fails if site/board is present, because a deploy would publish it.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const board = join(dirname(fileURLToPath(import.meta.url)), "..", "site", "board");
if (existsSync(board)) {
  console.error("site/board would be published with the v3 site. Remove site/board. Preview the board from board/public.");
  process.exit(1);
}
console.log("ok   site/ does not publish the board");
