const supportedExtensions = new Set([
  "c", "cc", "cpp", "cs", "dart", "go", "java", "js", "kt", "php", "py", "rb", "rs",
  "scala", "sql", "swift", "ts",
]);

const aliases: Record<string, string> = {
  "c++": "cpp",
  "c++17": "cpp",
  "c++20": "cpp",
  cpp: "cpp",
  csharp: "cs",
  "c#": "cs",
  golang: "go",
  javascript: "js",
  javascript20: "js",
  java: "java",
  kotlin: "kt",
  kotlin19: "kt",
  python: "py",
  python2: "py",
  python3: "py",
  pypy: "py",
  pypy3: "py",
  ruby: "rb",
  rust: "rs",
  typescript: "ts",
  "textx-c++src": "cpp",
  "textx-csrc": "c",
  "textx-java": "java",
  textxpython: "py",
  textjavascript: "js",
  "objective-c": "c",
};

export function languageExtension(language: string): string | undefined {
  const normalized = language.trim().toLowerCase().replaceAll(/[^a-z0-9+#-]/g, "");
  const extension = aliases[normalized] ?? normalized.replace(/^gnu/, "").replace(/\d+$/, "");
  return supportedExtensions.has(extension) ? extension : undefined;
}

export function isSolutionFilename(filename: string): boolean {
  const match = /^solution\.([a-z0-9]+)$/i.exec(filename);
  return Boolean(match && supportedExtensions.has(match[1].toLowerCase()));
}
