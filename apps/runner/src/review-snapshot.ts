import { execFile } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const allowed = /\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|rb|sh|sql|css|html|md|json|ya?ml|toml)$/i;
const excluded = /(?:^|\/)(?:\.[^/]+|AGENTS\.md|SKILL\.md|node_modules|vendor|dist|secrets?|credentials?)(?:\/|$)|(?:secret|credential|private[-_]?key)|(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml)$/i;

export async function createReviewSnapshot(repositoryPath: string, destination: string, signal: AbortSignal) {
  if (await realpath(repositoryPath) !== repositoryPath) throw new Error("The registered repository moved.");
  const git = async (args: string[], maxBuffer = 2_000_000) => (await execute("/usr/bin/git",
    ["-c", "core.hooksPath=/dev/null", "-C", repositoryPath, ...args],
    { signal, timeout: 10_000, maxBuffer, env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, encoding: "buffer" })).stdout;
  const commit = (await git(["rev-parse", "--verify", "HEAD^{commit}"])).toString().trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Invalid repository commit.");
  const tree = (await git(["ls-tree", "-rlz", commit])).toString("utf8").split("\0").filter(Boolean);
  await mkdir(destination, { mode: 0o700 });
  let files = 0;
  let bytes = 0;
  for (const entry of tree) {
    signal.throwIfAborted();
    const match = /^(100644|100755) blob ([a-f0-9]+)\s+(\d+)\t(.+)$/s.exec(entry);
    if (!match) continue;
    const [, , object, sizeText, path] = match;
    const size = Number(sizeText);
    if (!allowed.test(path) || excluded.test(path) || path.startsWith("/") || path.split("/").some((part) => part === "..")
      || /[\x00-\x1f\x7f]/.test(path) || size > 128_000 || bytes + size > 2_000_000 || files >= 200) continue;
    const contents = await git(["cat-file", "blob", object], 128_001);
    if (contents.includes(0)) continue;
    await mkdir(dirname(join(destination, path)), { recursive: true, mode: 0o700 });
    await writeFile(join(destination, path), contents, { mode: 0o400, flag: "wx" });
    files += 1;
    bytes += contents.length;
  }
  if (!files) throw new Error("No eligible tracked source files.");
  return { commit, files, bytes, totalEntries: tree.length };
}
