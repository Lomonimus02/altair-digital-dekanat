import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

const fonts = [
  "server/assets/fonts/NotoSans-Regular.ttf",
  "server/assets/fonts/NotoSans-Bold.ttf",
  "server/assets/fonts/OFL-NotoSans.txt",
];

it("шрифты PDF лежат в репозитории и обязательны для релиза", () => {
  for (const file of fonts) expect(existsSync(file), file).toBe(true);
  const pack = readFileSync("scripts/pack-artifacts.mjs", "utf8");
  const check = readFileSync("scripts/release-check.mjs", "utf8");
  expect(pack).toContain("server/assets/fonts");
  expect(pack).toContain("missingReleaseFonts");
  for (const file of fonts) expect(check).toContain(path.basename(file));
});

it("проверка релиза падает, если шрифтов нет", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "altair-release-"));
  try {
    writeFileSync(path.join(dir, "package.json"), "{}\n");
    const archive = path.join(dir, "empty.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", dir, "package.json"]);
    expect(() => execFileSync("node", ["scripts/release-check.mjs", archive], { encoding: "utf8", stdio: "pipe" })).toThrow(/NotoSans/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
