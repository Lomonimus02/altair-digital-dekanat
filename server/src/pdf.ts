import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { CONTEST_NOTE, UNIVERSITY } from "../../shared/src/domain";

let regular: Buffer | null = null;
let bold: Buffer | null = null;

function font(name: string) {
  return readFileSync(path.resolve(process.cwd(), "server/assets/fonts", name));
}

export async function renderCertificate(input: {
  title: string;
  studentName: string;
  institute: string | null;
  direction: string | null;
  course: number | null;
  groupName: string | null;
  purpose: string | null;
  issuedAt: string;
  code: string;
  verifyUrl: string;
}) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  regular ??= font("NotoSans-Regular.ttf");
  bold ??= font("NotoSans-Bold.ttf");
  const fontRegular = await pdf.embedFont(regular, { subset: true });
  const fontBold = await pdf.embedFont(bold, { subset: true });
  const page = pdf.addPage([595.28, 841.89]);
  const ink = rgb(0.07, 0.14, 0.12);
  const muted = rgb(0.25, 0.33, 0.3);
  const green = rgb(0.02, 0.42, 0.28);

  page.drawText("КОНЦЕПТ · НЕ ОФИЦИАЛЬНЫЙ ДОКУМЕНТ", {
    x: 78,
    y: 430,
    size: 22,
    font: fontBold,
    color: rgb(0.75, 0.82, 0.78),
    rotate: degrees(32),
    opacity: 0.55,
  });

  page.drawRectangle({ x: 0, y: 790, width: 595, height: 52, color: rgb(0.9, 0.98, 0.95) });
  page.drawText(UNIVERSITY, { x: 48, y: 814, size: 16, font: fontBold, color: green });
  page.drawText("КОНЦЕПТ · НЕ ОФИЦИАЛЬНЫЙ ДОКУМЕНТ УНИВЕРСИТЕТА", { x: 48, y: 796, size: 9, font: fontBold, color: green });

  let y = 740;
  page.drawText(input.title, { x: 48, y, size: 22, font: fontBold, color: ink });
  y -= 28;
  page.drawText("Сформировано автоматически в учебном концепте.", { x: 48, y, size: 11, font: fontRegular, color: muted });
  y -= 36;

  const rows: [string, string][] = [
    ["Студент", input.studentName],
    ["Институт", input.institute ?? "—"],
    ["Направление", input.direction ?? "—"],
    ["Курс", input.course ? String(input.course) : "—"],
    ["Группа", input.groupName ?? "—"],
    ["Назначение", input.purpose ?? "Для предъявления по месту требования"],
    ["Дата", input.issuedAt],
    ["Код проверки", input.code],
  ];
  for (const [label, value] of rows) {
    page.drawText(label, { x: 48, y, size: 10, font: fontRegular, color: muted });
    y -= 16;
    for (const line of wrap(value, fontRegular, 12, 340)) {
      page.drawText(line, { x: 48, y, size: 12, font: fontBold, color: ink });
      y -= 16;
    }
    y -= 8;
  }

  page.drawText("Студент числится в академии. Оценки и номер зачётной книжки на эту справку не выносятся.", {
    x: 48,
    y: y - 8,
    size: 10,
    font: fontRegular,
    color: muted,
  });

  const qr = await pdf.embedPng(await QRCode.toBuffer(input.verifyUrl, { width: 280, margin: 1, errorCorrectionLevel: "M" }));
  page.drawImage(qr, { x: 430, y: 78, width: 110, height: 110 });
  page.drawText("Проверка", { x: 452, y: 64, size: 9, font: fontRegular, color: muted });

  const note = wrap(CONTEST_NOTE, fontRegular, 8, 500);
  let noteY = 42;
  for (const line of note) {
    page.drawText(line, { x: 48, y: noteY, size: 8, font: fontRegular, color: muted });
    noteY -= 10;
  }

  return Buffer.from(await pdf.save());
}

function wrap(text: string, font: { widthOfTextAtSize: (text: string, size: number) => number }, size: number, max: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > max && current) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}
