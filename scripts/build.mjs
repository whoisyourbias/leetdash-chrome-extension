import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(extensionRoot, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
execFileSync("tsc", ["-p", "tsconfig.json"], {
  cwd: extensionRoot,
  stdio: "inherit",
});
await cp(path.join(extensionRoot, "static"), output, {
  recursive: true,
  filter: (source) => path.basename(source) !== ".DS_Store",
});

const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3 || manifest.background?.type !== "module") {
  throw new Error("Built extension manifest is invalid.");
}
console.log(`Built Chrome extension at ${path.relative(extensionRoot, output)}`);
