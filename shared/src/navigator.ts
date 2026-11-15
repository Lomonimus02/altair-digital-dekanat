import { daysBetween } from "./dates";
import type { DisciplineView } from "./domain";

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

const AUTO5 = 4.75;
const AUTO4 = 4.2;
const AUTOPASS = 3;

export function formatMark(n: number): string {
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function analyzeDiscipline(d: DisciplineView, todayISO: string): NavigatorItem {
  const currentValues = d.marks
    .filter((m) => m.kind === "current" && m.value != null && m.value >= 2)
    .map((m) => m.value as number);
  const average = currentValues.length
    ? currentValues.reduce((a, b) => a + b, 0) / currentValues.length
    : null;
  const min = currentValues.length ? Math.min(...currentValues) : null;
  const exam = d.marks.find((m) => m.kind === "exam" && m.value != null);
  const credit = d.marks.find((m) => m.kind === "credit" && m.value != null);
  const allObl = d.obligatoryDone >= d.obligatoryTotal;
  const daysLeft = d.sessionDate ? daysBetween(todayISO, d.sessionDate) : null;
  const remaining = Math.max(0, d.obligatoryTotal - d.obligatoryDone);

  let automatic: Automatic = null;
  let finalText: string | null = null;
  let risk: Risk = "low";
  const details: string[] = [];
  let headline = "";

  if (d.controlForm === "exam" && exam?.value != null) {
    finalText = String(exam.value);
    risk = exam.value <= 2 ? "high" : "low";
    headline =
      exam.value <= 2
        ? `${d.name}: экзамен не сдан, это задолженность.`
        : `${d.name}: экзамен уже стоит — ${exam.value}.`;
    details.push("Автомат считается только до экзамена. Итог в ведомости — оценка экзамена.");
  } else if (d.controlForm === "credit" && credit?.value != null) {
    const passed = credit.value >= 1;
    finalText = passed ? "зачтено" : "незачёт";
    risk = passed ? "low" : "high";
    headline = passed ? `${d.name}: зачёт уже стоит.` : `${d.name}: незачёт, это задолженность.`;
  } else {
    const blockedByTwo = min != null && min <= 2;
    if (d.controlForm === "exam") {
      if (allObl && average != null && average >= AUTO5 && min != null && min >= 4) automatic = "5";
      else if (allObl && average != null && average >= AUTO4 && min != null && min >= 3) automatic = "4";
    } else if (allObl && average != null && average >= AUTOPASS && min != null && min >= 3) {
      automatic = "pass";
    }

    if (blockedByTwo || (average != null && average < 3) || (daysLeft != null && daysLeft < 0)) risk = "high";
    else if (!allObl && daysLeft != null && daysLeft <= 7) risk = "high";
    else if (!automatic) risk = "medium";
    else risk = "low";

    if (average == null && (daysLeft == null || daysLeft > 7)) risk = "medium";

    const avgText = average == null ? "текущих оценок нет" : `среднее ${formatMark(average)}`;
    if (automatic === "5") headline = `${d.name}: доступен автомат «отлично». ${capitalize(avgText)}.`;
    else if (automatic === "4") headline = `${d.name}: доступен автомат «хорошо». ${capitalize(avgText)}.`;
    else if (automatic === "pass") headline = `${d.name}: зачёт можно поставить автоматом. ${capitalize(avgText)}.`;
    else if (blockedByTwo) headline = `${d.name}: автомат закрыт, пока в текущих есть оценка 2.`;
    else if (d.controlForm === "exam") headline = `${d.name}: экзамен нужен. ${capitalize(avgText)}.`;
    else headline = `${d.name}: зачёт пока не закрыт. ${capitalize(avgText)}.`;

    if (currentValues.length) details.push(`Текущие оценки: ${currentValues.join(", ")}.`);
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
    if (blockedByTwo) {
      details.push("Пересдайте работу с оценкой 2 минимум на 3 — иначе автомат не откроется.");
    }
    if (remaining === 1 && !blockedByTwo && average != null) {
      const for5 = nextMark(currentValues, AUTO5, 4);
      const for4 = nextMark(currentValues, AUTO4, 3);
      const forPass = nextMark(currentValues, AUTOPASS, 3);
      if (d.controlForm === "exam") {
        if (for5.already) details.push("По среднему автомат «отлично» уже набирается — закройте последнюю работу оценкой не ниже 4.");
        else if (for5.mark) details.push(`Для автомата «отлично» последняя обязательная работа должна быть не ниже ${for5.mark}.`);
        else details.push("Одной работой до автомата «отлично» уже не дотянуть.");
        if (!for4.already && for4.mark) details.push(`Для автомата «хорошо» достаточно оценки не ниже ${for4.mark}.`);
        else if (for4.already) details.push("Для автомата «хорошо» хватит закрыть работу без оценки ниже 3.");
      } else if (forPass.mark) {
        details.push(`Чтобы получить зачёт автоматом, закройте работу оценкой не ниже ${forPass.mark}.`);
      }
    } else if (remaining > 1) {
      details.push(`Автомат посчитаем после оставшихся работ: ещё ${remaining}.`);
    } else if (remaining === 0 && !automatic && !blockedByTwo && d.controlForm === "exam") {
      details.push("Порог автомата не взят. На экзамене 5 — это пятёрка, 4 — четвёрка, не ниже 3 — без задолженности.");
      if (average != null && average < AUTO5) {
        details.push(`До автомата «отлично» не хватает среднего ${formatMark(AUTO5)} (сейчас ${formatMark(average)}).`);
      }
    }
    if (automatic === "5") details.push("На экзамен можно не приходить: в ведомость поставят 5.");
    if (automatic === "4") details.push("Автомат «хорошо» уже можно зафиксировать. Пятёрка — только если среднее дорастёт до 4,75 и не будет оценок ниже 4.");
    if (automatic === "pass") details.push("Зачёт закроется без явки, когда учебный офис проставит его в ведомость.");
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
    .map((d) => analyzeDiscipline(d, todayISO))
    .sort((a, b) => rank[a.risk] - rank[b.risk] || (a.daysLeft ?? 99) - (b.daysLeft ?? 99));
}

export function withHypothetical(d: DisciplineView, value: number): DisciplineView {
  return {
    ...d,
    obligatoryDone: Math.min(d.obligatoryTotal, d.obligatoryDone + (d.obligatoryDone < d.obligatoryTotal ? 1 : 0)),
    marks: [
      ...d.marks,
      { id: -1, label: "Предположение", value, kind: "current", awardedOn: null },
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
