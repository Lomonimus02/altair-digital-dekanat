import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FONT_FILES, missingReleaseFonts } from "./release-check.mjs";

const root = process.cwd();
const commit = process.argv[2] ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const outDir = process.argv[3] ?? "/opt/cursor/artifacts";
for (const file of FONT_FILES) {
  if (!existsSync(path.join(root, file))) {
    console.error(`Нет файла шрифта: ${file}`);
    process.exit(1);
  }
}
const stage = mkdtempSync(path.join(tmpdir(), "altair-pack-"));
try {
  const snapshot = path.join(stage, "snapshot.tar");
  execFileSync("git", ["archive", "--format=tar", `--prefix=altair-digital-dekanat/`, "-o", snapshot, commit]);
  execFileSync("tar", ["-C", stage, "-xf", snapshot]);
  const packed = path.join(stage, "altair-digital-dekanat");
  cpSync(path.join(root, "client/dist"), path.join(packed, "client/dist"), { recursive: true });
  cpSync(path.join(root, "server/dist"), path.join(packed, "server/dist"), { recursive: true });
  const source = path.join(outDir, "altair-source.tar.gz");
  const release = path.join(outDir, "altair-release.tar.gz");
  execFileSync("git", ["archive", "--format=tar.gz", `--prefix=altair-digital-dekanat/`, "-o", source, commit]);
  execFileSync("tar", [
    "-czf",
    release,
    "-C",
    stage,
    "altair-digital-dekanat/package.json",
    "altair-digital-dekanat/package-lock.json",
    "altair-digital-dekanat/.env.example",
    "altair-digital-dekanat/DEPLOY.md",
    "altair-digital-dekanat/README.md",
    "altair-digital-dekanat/LICENSE",
    "altair-digital-dekanat/client/dist",
    "altair-digital-dekanat/server/dist",
    "altair-digital-dekanat/server/migrations",
    "altair-digital-dekanat/server/assets/fonts",
  ]);
  const missing = missingReleaseFonts(release);
  if (missing.length) {
    console.error(`В релизе нет шрифтов PDF: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(commit);
  console.log(source);
  console.log(release);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
