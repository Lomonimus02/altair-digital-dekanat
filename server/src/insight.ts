import { formatDdMm, moscowToday } from "../../shared/src/dates";
import type { AnswerCard, PublicUser, UiDirective } from "../../shared/src/domain";
import { formatPercent, formatScore, semesterBounds } from "../../shared/src/journal";
import { matchDiscipline } from "../../shared/src/parser";
import { samePerson } from "../../shared/src/names";
import { forbidden, notFound } from "./httpError";
import { loadForTeacher, teacherAssignments } from "./homework";
import { loadJournal } from "./journal";

type Journal = Awaited<ReturnType<typeof loadJournal>>;
type Load = Awaited<ReturnType<typeof loadForTeacher>>;

const STATUS_RU: Record<string, string> = { absent: "Н", sick: "Б", late: "О", excused: "У" };

function dot(text: string) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function short(name: string) {
  const [last, first, middle] = name.split(" ");
  if (!first) return name;
  return `${last} ${first[0]}.${middle ? ` ${middle[0]}.` : ""}`;
}

function pickPairs(load: Load, groupName?: string, discipline?: string) {
  const names = [...new Set(load.map((row) => row.discipline))];
  const wanted = discipline ? matchDiscipline(discipline, names) ?? names.find((name) => name.toLowerCase().includes(discipline.toLowerCase())) : undefined;
  if (discipline && !wanted) throw notFound("Этот предмет вы не ведёте");
  const group = groupName ? load.find((row) => row.groupName.toLowerCase() === groupName.toLowerCase())?.groupName : undefined;
  if (groupName && !group) throw notFound("Эту группу вы не ведёте");
  return load.filter((row) => (!wanted || row.discipline === wanted) && (!group || row.groupName === group));
}

async function journalFor(user: PublicUser, groupName: string, discipline: string) {
  const term = semesterBounds(moscowToday());
  return loadJournal(user, groupName, discipline, term.from, term.to);
}

function journalLink(groupName: string, discipline: string, ids: number[]) {
  const term = semesterBounds(moscowToday());
  const hl = ids.length ? `&hl=${ids.join(",")}` : "";
  return `/teach/journal?group=${encodeURIComponent(groupName)}&discipline=${encodeURIComponent(discipline)}&from=${term.from}&to=${term.to}${hl}`;
}

function studentLines(journal: Journal, studentId: number) {
  const cells = journal.cells.filter((cell) => cell.studentId === studentId && cell.value != null);
  const grades = cells
    .map((cell) => {
      const column = journal.columns.find((item) => item.id === cell.columnId);
      return column ? { date: column.date, text: `${formatDdMm(column.date)} ${column.title}: ${formatScore(Number(cell.value))}/${column.maxPoints}` } : null;
    })
    .filter((row): row is { date: string; text: string } => Boolean(row))
    .sort((a, b) => a.date.localeCompare(b.date));
  const misses = journal.attendance.filter((row) => row.studentId === studentId && row.status !== "present").sort((a, b) => a.date.localeCompare(b.date));
  const average = journal.averages[studentId];
  return { grades, misses, average };
}

export async function teacherStudentInfo(user: PublicUser, args: { studentName: string; groupName?: string; discipline?: string; topic?: string }) {
  if (user.role !== "teacher") throw forbidden();
  const pairs = pickPairs(await loadForTeacher(user.id), args.groupName, args.discipline);
  const hits: { journal: Journal; student: Journal["students"][number] }[] = [];
  for (const pair of pairs) {
    const journal = await journalFor(user, pair.groupName, pair.discipline);
    const found = journal.students.filter((row) => samePerson(args.studentName, row.name));
    if (found.length === 1) hits.push({ journal, student: found[0] });
  }
  if (!hits.length) return { summary: args.groupName || args.discipline ? "Такого студента в этой группе или предмете нет." : "Такого студента в ваших группах нет." };
  const names = [...new Set(hits.map((hit) => hit.student.name))];
  if (names.length > 1) return { summary: `Нашёл нескольких: ${names.map(short).join(", ")}. Уточните фамилию и имя.` };
  const topic = args.topic ?? "all";
  const rows: AnswerCard["rows"] = [];
  const parts: string[] = [];
  for (const { journal, student } of hits) {
    const { grades, misses, average } = studentLines(journal, student.id);
    const total = average && average.possible ? `${formatScore(average.earned)} из ${formatScore(average.possible)} (${formatPercent(average.percent)})${average.grade ? `, ${average.grade}` : ""}` : "оценок пока нет";
    const missText = misses.length ? `${misses.length}: ${misses.slice(-6).map((row) => `${formatDdMm(row.date)} ${STATUS_RU[row.status] ?? row.status}`).join(", ")}` : "нет";
    const head = hits.length > 1 ? `${journal.discipline}` : "";
    if (topic === "grades" || topic === "all") {
      rows.push({ label: head ? `${head} — оценки` : "Оценки", value: grades.length ? grades.slice(-8).map((row) => row.text).join("; ") : "пока нет" });
    }
    if (topic === "average" || topic === "all" || topic === "grades") rows.push({ label: head ? `${head} — итог` : "Итог за семестр", value: total });
    if (topic === "attendance" || topic === "all") rows.push({ label: head ? `${head} — пропуски` : "Пропуски", value: missText });
    parts.push(
      topic === "attendance"
        ? `${journal.discipline}: пропусков ${misses.length}`
        : topic === "average"
          ? `${journal.discipline}: ${total}`
          : `${journal.discipline}: ${grades.length ? grades.slice(-5).map((row) => row.text).join("; ") : "оценок пока нет"}; итог ${total}`,
    );
  }
  const first = hits[0];
  const title = `${short(first.student.name)} · ${first.journal.groupName}`;
  const ui: UiDirective[] = [{ type: "navigate", to: journalLink(first.journal.groupName, first.journal.discipline, [first.student.id]), highlight: `journal-row-${first.student.id}` }];
  return { summary: dot(`${first.student.name}, ${first.journal.groupName}. ${parts.join(". ")}`), card: { title, rows }, ui };
}

export async function teacherGroupInfo(user: PublicUser, args: { groupName?: string; discipline?: string; topic: string }) {
  if (user.role !== "teacher") throw forbidden();
  const load = await loadForTeacher(user.id);
  const pairs = pickPairs(load, args.groupName, args.discipline);
  if (!pairs.length) return { summary: "Такой пары группа — предмет у вас нет." };
  const groups = [...new Set(pairs.map((row) => row.groupName))];
  if (groups.length > 1 && args.topic !== "roster") {
    return { summary: `Уточните группу: ${groups.join(", ")}. Или откройте журнал нужной группы и спросите снова.` };
  }
  if (args.topic === "roster") {
    const pair = pairs[0];
    const journal = await journalFor(user, pair.groupName, pair.discipline);
    const list = journal.students.map((row) => short(row.name));
    return {
      summary: dot(`${pair.groupName}: ${list.length} студентов — ${list.join(", ")}`),
      card: { title: `Группа ${pair.groupName}`, rows: [{ label: `Студентов: ${list.length}`, value: list.join(", ") }] },
      ui: [{ type: "navigate", to: journalLink(pair.groupName, pair.discipline, []), highlight: "journal" }] as UiDirective[],
    };
  }
  const subjects = pairs.filter((row) => row.groupName === groups[0]);
  if (subjects.length > 1 && !args.discipline) {
    return { summary: `В группе ${groups[0]} у вас несколько предметов: ${subjects.map((row) => row.discipline).join(", ")}. Назовите предмет.` };
  }
  const pair = subjects[0];
  const journal = await journalFor(user, pair.groupName, pair.discipline);
  const threshold = journal.scheme.satisfactory ?? 50;
  let picked: Journal["students"] = [];
  let label = "";
  let line = (student: Journal["students"][number]) => short(student.name);
  if (args.topic === "no_grade") {
    picked = journal.students.filter((row) => !(journal.averages[row.id]?.count));
    label = "Без оценок";
  } else if (args.topic === "debts") {
    picked = journal.students.filter((row) => {
      const average = journal.averages[row.id];
      return !average?.count || (average.percent ?? 0) < threshold;
    });
    label = `Ниже ${threshold}% или без оценок`;
    line = (student) => `${short(student.name)} — ${journal.averages[student.id]?.count ? formatPercent(journal.averages[student.id]?.percent ?? null) : "нет оценок"}`;
  } else {
    const counts = journal.students.map((row) => ({ row, misses: journal.attendance.filter((item) => item.studentId === row.id && item.status !== "present").length })).filter((item) => item.misses > 0).sort((a, b) => b.misses - a.misses);
    picked = counts.map((item) => item.row);
    label = "Пропуски";
    line = (student) => `${short(student.name)} — ${counts.find((item) => item.row.id === student.id)?.misses ?? 0}`;
  }
  const text = picked.length ? picked.map(line).join(", ") : args.topic === "attendance" ? "пропусков нет" : "таких нет";
  return {
    summary: dot(`${pair.groupName}, ${pair.discipline}. ${label}: ${text}`),
    card: { title: `${pair.groupName} · ${pair.discipline}`, rows: [{ label: picked.length ? `${label} · ${picked.length}` : label, value: text }] },
    ui: [{ type: "navigate", to: journalLink(pair.groupName, pair.discipline, picked.map((row) => row.id)), highlight: picked[0] ? `journal-row-${picked[0].id}` : "journal" }] as UiDirective[],
  };
}

export async function teacherAssignmentsInfo(user: PublicUser, args: { groupName?: string; discipline?: string }) {
  const rows = (await teacherAssignments(user)).filter((row) =>
    (!args.groupName || row.groupName.toLowerCase() === args.groupName.toLowerCase()) &&
    (!args.discipline || (matchDiscipline(args.discipline, [row.discipline]) ?? (row.discipline.toLowerCase().includes(args.discipline.toLowerCase()) ? row.discipline : "")) === row.discipline));
  if (!rows.length) return { summary: "Выданных заданий нет.", ui: [{ type: "navigate", to: "/teach/assignments", highlight: "assignments" }] as UiDirective[] };
  const active = rows.filter((row) => !row.overdue);
  const review = rows.reduce((sum, row) => sum + row.counts.review, 0);
  const shown = (active.length ? active : rows.slice(-5)).slice(0, 6);
  return {
    summary: `Выдано заданий: ${rows.length}, активных ${active.length}, на проверке работ: ${review}.`,
    card: { title: "Выданные задания", rows: shown.map((row) => ({ label: `${row.groupName} · до ${formatDdMm(row.deadline)}`, value: `${row.title} — сдали ${row.counts.turnedIn} из ${row.counts.total}${row.counts.review ? `, на проверке ${row.counts.review}` : ""}` })) },
    ui: [{ type: "navigate", to: "/teach/assignments", highlight: shown[0] ? `issued-${shown[0].id}` : "assignments" }] as UiDirective[],
  };
}
