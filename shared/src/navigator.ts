import { daysBetween } from "./dates";
import type { DisciplineView } from "./domain";
import { DEFAULT_THRESHOLDS, finalByPercent, formatPercent, pointsTotal } from "./journal";

export type Risk = "low" | "medium" | "high";
export type Automatic = "5" | "4" | "pass" | null;

export interface NavigatorItem {
  id: number;
  name: string;
  controlForm: "exam" | "credit";
  sessionDate: string | null;
  average: number | null;
  currentValues: number[];
  obligatoryTotal: number;
  obligatoryDone: number;
  automatic: Automatic;
  finalText: string | null;
  risk: Risk;
  headline: string;
  statusText: string;
  details: string[];
  daysLeft: number | null;
}

export function formatMark(n: number): string {
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function analyzeDiscipline(d: DisciplineView, todayISO: string, thresholds = DEFAULT_THRESHOLDS): NavigatorItem {
  const scored = d.marks
    .filter((mark) => mark.points != null)
    .map((mark) => ({ points: Number(mark.points), maxPoints: mark.maxPoints ?? 10, weight: mark.weight ?? 1, label: mark.label }));
  const total = pointsTotal(scored, thresholds);
  const average = total.percent;
  const currentValues = scored.map((mark) => Math.round((mark.points / mark.maxPoints) * 1000) / 10);
  const low = scored.filter((mark) => (mark.points / mark.maxPoints) * 100 < thresholds.satisfactory);
  const exam = d.marks.find((m) => m.kind === "exam" && m.points != null);
  const credit = d.marks.find((m) => m.kind === "credit" && m.points != null);
  const allObl = d.obligatoryDone >= d.obligatoryTotal;
  const daysLeft = d.sessionDate ? daysBetween(todayISO, d.sessionDate) : null;
  const remaining = Math.max(0, d.obligatoryTotal - d.obligatoryDone);

  let automatic: Automatic = null;
  let finalText: string | null = null;
  let risk: Risk = "low";
  const details: string[] = [];
  let headline = "";

  if (d.controlForm === "exam" && exam?.points != null) {
    const ratio = (exam.points / (exam.maxPoints ?? 10)) * 100;
    finalText = finalByPercent(ratio, thresholds);
    risk = ratio < thresholds.satisfactory ? "high" : "low";
    headline = ratio < thresholds.satisfactory
      ? `${d.name}: экзамен ниже ${thresholds.satisfactory}%, это задолженность.`
      : `${d.name}: экзамен уже стоит — ${formatPercent(ratio)}.`;
    details.push("Итог считается по баллам и порогам предмета.");
  } else if (d.controlForm === "credit" && credit?.points != null) {
    const ratio = (credit.points / (credit.maxPoints ?? 10)) * 100;
    const passed = ratio >= thresholds.satisfactory;
    finalText = passed ? "зачтено" : "незачёт";
    risk = passed ? "low" : "high";
    headline = passed ? `${d.name}: зачёт уже стоит.` : `${d.name}: незачёт, это задолженность.`;
  } else {
    const blocked = low.length > 0;
    if (d.controlForm === "exam") {
      if (allObl && average != null && average >= thresholds.excellent && !blocked) automatic = "5";
      else if (allObl && average != null && average >= thresholds.good && !blocked) automatic = "4";
    } else if (allObl && average != null && average >= thresholds.satisfactory && !blocked) {
      automatic = "pass";
    }

    if (blocked || (average != null && average < thresholds.satisfactory) || (daysLeft != null && daysLeft < 0)) risk = "high";
    else if (!allObl && daysLeft != null && daysLeft <= 7) risk = "high";
    else if (!automatic) risk = "medium";
    else risk = "low";

    if (average == null && (daysLeft == null || daysLeft > 7)) risk = "medium";

    const avgText = average == null ? "баллов пока нет" : formatPercent(average);
    if (automatic === "5") headline = `${d.name}: по баллам выходит «отлично». ${avgText}.`;
    else if (automatic === "4") headline = `${d.name}: по баллам выходит «хорошо». ${avgText}.`;
    else if (automatic === "pass") headline = `${d.name}: зачёт закрывается баллами. ${avgText}.`;
    else if (blocked) headline = `${d.name}: есть работы ниже ${thresholds.satisfactory}%. Итог ${avgText}.`;
    else if (d.controlForm === "exam") headline = `${d.name}: итог ещё открыт. ${avgText}.`;
    else headline = `${d.name}: зачёт пока не закрыт. ${avgText}.`;

    if (scored.length) details.push(`Баллы: ${scored.map((mark) => `${mark.points}/${mark.maxPoints}`).join(", ")}.`);
    if (d.obligatoryTotal) {
      details.push(`Обязательные работы: ${d.obligatoryDone} из ${d.obligatoryTotal}.`);
    }
    if (d.sessionDate) {
      const when =
        daysLeft == null
          ? ""
          : daysLeft < 0
            ? "срок уже прошёл"
            : daysLeft === 0
              ? "сегодня"
              : `через ${daysLeft} дн.`;
      details.push(`Аттестация ${d.sessionDate}${when ? ` (${when})` : ""}.`.replace(d.sessionDate, formatSession(d.sessionDate)));
    }
    if (blocked) {
      details.push(`Ниже ${thresholds.satisfactory}%: ${low.map((mark) => mark.label).join(", ")}.`);
    }
    if (remaining === 1 && !blocked && average != null) {
      if (d.controlForm === "exam") {
        if (average >= thresholds.excellent) details.push(`Для «отлично» (${thresholds.excellent}%) уже хватает. Закройте последнюю работу не ниже ${thresholds.good}%.`);
        else details.push(`Для «отлично» нужно дотянуть итог до ${thresholds.excellent}%, для «хорошо» — до ${thresholds.good}%.`);
      } else {
        details.push(`Чтобы закрыть зачёт, держите итог не ниже ${thresholds.satisfactory}%.`);
      }
    } else if (remaining > 1) {
      details.push(`Итог посчитаем после оставшихся работ: ещё ${remaining}.`);
    } else if (remaining === 0 && !automatic && !blocked && d.controlForm === "exam") {
      details.push(`Пороги: отлично ${thresholds.excellent}%, хорошо ${thresholds.good}%, удовлетворительно ${thresholds.satisfactory}%.`);
      if (average != null && average < thresholds.excellent) {
        details.push(`До «отлично» не хватает ${formatPercent(thresholds.excellent)} (сейчас ${formatPercent(average)}).`);
      }
    }
    if (automatic === "5") details.push("По баллам выходит «отлично».");
    if (automatic === "4") details.push("По баллам выходит «хорошо». «Отлично», если итог дорастёт до порога и не будет работ ниже него.");
    if (automatic === "pass") details.push("Зачёт закрывается накопленными баллами.");
  }

  return {
    id: d.id,
    name: d.name,
    controlForm: d.controlForm,
    sessionDate: d.sessionDate,
    average,
    currentValues,
    obligatoryTotal: d.obligatoryTotal,
    obligatoryDone: d.obligatoryDone,
    automatic,
    finalText,
    risk,
    headline,
    statusText: headline.startsWith(`${d.name}: `) ? headline.slice(d.name.length + 2) : headline,
    details,
    daysLeft,
  };
}

export function analyzeSession(list: DisciplineView[], todayISO: string): NavigatorItem[] {
  const rank = { high: 0, medium: 1, low: 2 };
  return list
    .map((d) => analyzeDiscipline(d, todayISO, d.thresholds))
    .sort((a, b) => rank[a.risk] - rank[b.risk] || (a.daysLeft ?? 99) - (b.daysLeft ?? 99));
}

export function withHypothetical(d: DisciplineView, points: number, maxPoints = 10): DisciplineView {
  return {
    ...d,
    obligatoryDone: Math.min(d.obligatoryTotal, d.obligatoryDone + (d.obligatoryDone < d.obligatoryTotal ? 1 : 0)),
    marks: [
      ...d.marks,
      { id: -1, label: "Предположение", value: null, points, maxPoints, weight: 1, kind: "current", awardedOn: null },
    ],
  };
}

function nextMark(values: number[], target: number, floor: number): { already: boolean; mark: number | null } {
  const sum = values.reduce((a, b) => a + b, 0);
  const n = values.length;
  if (sum / n >= target) return { already: true, mark: null };
  const need = target * (n + 1) - sum;
  const mark = Math.max(floor, Math.ceil(need - 1e-9));
  if (mark <= 5) return { already: false, mark };
  return { already: false, mark: null };
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatSession(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).format(dt);
}
