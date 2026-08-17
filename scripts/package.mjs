import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(extensionRoot, "artifacts");
const archive = path.join(artifacts, "leetdash-extension.zip");

execFileSync(process.execPath, [path.join(extensionRoot, "scripts", "build.mjs")], {
  cwd: extensionRoot,
  stdio: "inherit",
});
await mkdir(artifacts, { recursive: true });
await rm(archive, { force: true });
execFileSync("zip", ["-qr", archive, ".", "-x", ".DS_Store", "*/.DS_Store"], {
  cwd: path.join(extensionRoot, "dist"),
  stdio: "inherit",
});
console.log(`Packaged Chrome extension at ${path.relative(extensionRoot, archive)}`);
