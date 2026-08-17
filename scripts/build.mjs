import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(extensionRoot, "dist");
const clientId = process.env.EXTENSION_GITHUB_CLIENT_ID;

if (!clientId || !/^[A-Za-z0-9_.-]+$/.test(clientId)) {
  throw new Error("Set EXTENSION_GITHUB_CLIENT_ID to the public GitHub OAuth App client ID.");
}

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

const configPath = path.join(output, "config.js");
const config = await readFile(configPath, "utf8");
await writeFile(configPath, config.replace("__GITHUB_CLIENT_ID__", clientId), "utf8");

const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3 || manifest.background?.type !== "module") {
  throw new Error("Built extension manifest is invalid.");
}
console.log(`Built Chrome extension at ${path.relative(extensionRoot, output)}`);
