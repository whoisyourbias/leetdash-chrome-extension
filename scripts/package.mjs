import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(extensionRoot, "artifacts");
const archive = path.join(artifacts, "leetdash-extension.zip");
const output = path.join(extensionRoot, "dist");

async function collectFiles(directory, prefix = "") {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const sourcePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, await collectFiles(sourcePath, archivePath));
    } else if (entry.isFile()) {
      files[archivePath] = new Uint8Array(await readFile(sourcePath));
    }
  }
  return files;
}

execFileSync(process.execPath, [path.join(extensionRoot, "scripts", "build.mjs")], {
  cwd: extensionRoot,
  stdio: "inherit",
});
await mkdir(artifacts, { recursive: true });
await rm(archive, { force: true });
await writeFile(archive, zipSync(await collectFiles(output), { level: 9 }));
console.log(`Packaged Chrome extension at ${path.relative(extensionRoot, archive)}`);
