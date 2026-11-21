import { execFileSync } from "node:child_process";

export const FONT_FILES = [
  "server/assets/fonts/NotoSans-Regular.ttf",
  "server/assets/fonts/NotoSans-Bold.ttf",
  "server/assets/fonts/OFL-NotoSans.txt",
];

export function missingReleaseFonts(archive) {
  const list = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" });
  return FONT_FILES.filter((file) => !list.split("\n").some((line) => line.endsWith(file)));
}

if (process.argv[1] && process.argv[1].endsWith("release-check.mjs") && process.argv[2]) {
  const missing = missingReleaseFonts(process.argv[2]);
  if (missing.length) {
    console.error(`В релизе нет шрифтов PDF: ${missing.join(", ")}`);
    process.exit(1);
  }
}
