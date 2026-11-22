import type { Proposal, RequestKind, Role } from "./domain";
import { addDays, moscowToday, weekdayIndex } from "./dates";
import { journalDate, parseWorkType, WORK_TYPES } from "./journal";
import { impossibleDate, scheduleAsk } from "./schedule-ask";

const ALIASES: [string, string][] = [
  ["матан", "математический анализ"],
  ["матанализ", "математический анализ"],
  ["математическ", "математический анализ"],
  ["линал", "линейная алгебра"],
  ["линейн", "линейная алгебра"],
  ["бд", "базы данных"],
  ["базам данных", "базы данных"],
  ["базы данных", "базы данных"],
  ["баз данных", "базы данных"],
  ["программирован", "программирование"],
  ["экономик", "экономика фирмы"],
  ["конституцион", "конституционное право"],
  ["римск", "римское право"],
  ["теори государства", "теория государства и права"],
  ["тгп", "теория государства и права"],
  ["логик", "логика"],
  ["управлен проект", "управление проектами"],
  ["управлени проект", "управление проектами"],
  ["информационн технолог", "информационные технологии"],
  ["правоведен", "правоведение"],
  ["английск", "английский язык"],
  ["физическ культур", "физическая культура"],
  ["истори государства", "история государства и права"],
];

export function norm(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

export function matchDiscipline(query: string | undefined, names: string[]): string | undefined {
  if (!query) return undefined;
  const q = norm(query);
  for (const [alias, canonical] of ALIASES) {
    const hit = alias.length <= 3 ? new RegExp(`(^|[^а-яёa-z])${alias}([^а-яёa-z]|$)`).test(q) : q.includes(alias);
    if (hit) {
      const found = names.find((name) => norm(name).includes(canonical));
      if (found) return found;
    }
  }
  const direct = names.find((name) => q.includes(norm(name)));
  if (direct) return direct;
  let best: { name: string; score: number } | null = null;
  for (const name of names) {
    const tokens = norm(name).split(" ").filter((t) => t.length > 4);
    const score = tokens.filter((token) => q.includes(token.slice(0, 6))).length;
    if (score && (!best || score > best.score)) best = { name, score };
  }
  return best?.name;
}

export function parseIntent(message: string, role: Role, disciplines: string[] = []): Proposal {
  const t = norm(message);
  if (!t) return say("Напишите, что сделать.");
  if (/^\s*system\b/i.test(message) || /ignore previous|игнорируй предыдущ|you are now/i.test(message)) {
    return say("Это не просьба к деканату. Напишите своими словами, что сделать.");
  }

  if (role === "staff") {
    const staff = parseStaff(t, message);
    if (staff) return staff;
  }
  if (impossibleDate(message)) return say("Такой даты нет.");
  if (role === "teacher") {
    const taught = parseTeacher(t, message);
    if (taught) return taught;
    if (/поставь|оцен|балл|явк|отметь/.test(t)) return say("Не разобрал просьбу. Назовите студента, балл или букву явки, дату и предмет.");
  }
  const withdraw = extractRequestId(t);
  if (withdraw && /отзов/.test(t)) return step("Нужно подтвердить отзыв заявки.", "cancel_request", { requestId: withdraw });

  if (/задан|домашн|сдать|дедлайн|просроч/.test(t) && /справк|военкомат|закаж/.test(t)) {
    const kind = detectKind(t) ?? "military_certificate";
    return {
      say: "Сначала посмотрю, что сдать, затем подготовлю справку.",
      steps: [
        { tool: "list_homework", args: { bucket: "due" } },
        { tool: "create_request", args: { kind } },
      ],
    };
  }

  if (/отмени последнее|верни как было|отмени действие/.test(t)) {
    return step("Отменяю последнее действие.", "undo_last", {});
  }
  if (/темн/.test(t) && /тем|оформлен|включи|режим/.test(t)) return step("Включаю тёмную тему.", "update_settings", { theme: "dark" });
  if (/светл/.test(t) && /тем|оформлен|включи|режим/.test(t)) return step("Включаю светлую тему.", "update_settings", { theme: "light" });
  if (/системн.*тем|тема.*систем|как в системе/.test(t)) return step("Тема будет как в системе.", "update_settings", { theme: "system" });
  if (/скрой отмен|не показывай отмен/.test(t)) return step("Скрываю отменённые пары.", "update_settings", { showCancelled: false });
  if (/покажи отмен|верни отмен/.test(t)) return step("Снова показываю отмены.", "update_settings", { showCancelled: true });

  if (/прочита/.test(t) && /уведомл/.test(t)) return step("Отмечаю уведомления.", "mark_notifications_read", { all: true });
  if (/что делал агент|журнал агент|аудит|история агента/.test(t)) return step("Открываю журнал.", "get_audit", {});

  const reminder = parseReminder(t);
  if (reminder) return reminder;

  if (/скачай|скачать|pdf|пдф/.test(t)) {
    const kind = detectKind(t);
    return step("Ищу готовую справку.", "download_certificate", kind ? { kind } : {});
  }

  const requestId = extractRequestId(t);
  if (requestId && /где|статус|открой|покажи|заявк|справк/.test(t) && !/нужн|хочу|закаж|оформ|подать|подай/.test(t)) {
    return step(`Открываю заявку №${requestId}.`, "get_request_status", { requestId });
  }
  if (/статус заяв\S* на справк|статус справк/.test(t)) {
    const kind = t.includes("военкомат") ? "military_certificate" : t.includes("период") ? "period_certificate" : t.includes("об обучен") ? "study_certificate" : undefined;
    return step("Смотрю только справки.", "list_requests", { certificates: true, ...(kind ? { kind } : {}) });
  }
  if (/где моя справк|статус заяв|мои заяв|где заявк|что с заявк|что со справк/.test(t)) {
    return step("Проверяю ваши заявки.", "list_requests", {});
  }

  if (/долг|задолжен/.test(t)) {
    return {
      say: "Смотрю просроченные задания и то, что проседает в сессии.",
      steps: [
        { tool: "list_homework", args: { bucket: "overdue" } },
        { tool: "get_session_navigator", args: {} },
      ],
    };
  }

  if (/как получить|можно ли|положен|регламент/.test(t)) {
    return step("Ищу в положении.", "search_regulations", { query: message.trim().slice(0, 180) });
  }

  if (/сда(й|ть)/.test(t) && (/задани|домашк|лаб|эссе|работ|текстом|комментар|напиш/.test(t) || /«/.test(message))) {
    const body = submissionText(message);
    const namedText = /с\s+текстом|с\s+комментарием|напиш(?:и|ите)|комментарий\s*[:\-—]/.test(message);
    const head = message.replace(/\s*(?:,)?\s*(?:с\s+текстом|с\s+комментарием|напиш(?:и|ите)|комментарий\s*[:\-—])[\s\S]*$/i, "").trim();
    const quoted = head.match(/«([^»]+)»/);
    const subject = quoted?.[1] ?? matchDiscipline(head, disciplines) ?? head.replace(/^[\s\S]*?по\s+/i, "").split(":")[0].trim();
    return step("Готовлю сдачу. Её нужно подтвердить.", "submit_homework", { subject, body, ...(namedText || /домашк/.test(t) ? { pick: "nearest" } : {}) });
  }
  if (/отметь|звезд|звёзд/.test(t) && /пар|занят|расписан|конституц|предмет/.test(t)) {
    const subject = matchDiscipline(t, disciplines) ?? "";
    const asked = scheduleAsk(t, disciplines);
    return step("Отмечаю занятие.", "mark_schedule_item", {
      subject,
      flagged: !/сним|убери/.test(t),
      ...(asked?.date ? { date: asked.date } : asked?.when && asked.when !== "week" ? { when: asked.when } : {}),
    });
  }

  if (/справк|заявлен|академ|военкомат|материальн|перевод|закаж|подать заяв|нужн/.test(t) && detectKind(t)) {
    const kind = detectKind(t)!;
    const purpose = t.includes("военкомат") ? "Для предоставления в военный комиссариат" : undefined;
    return step("Собрал заявление. Его нужно подтвердить.", "create_request", { kind, ...(purpose ? { purpose } : {}) });
  }

  if (/что если|если\s+(?:я\s+)?(?:получу|поставлю|поставят|будет|сдам)/.test(t)) {
    const outOf = t.match(/(\d+(?:[.,]\d+)?)\s*(?:балл[а-яё]*\s*)?из\s*(\d+)/);
    const scored = outOf ?? t.match(/(\d+(?:[.,]\d+)?)\s*балл/) ?? t.match(/(\d+(?:[.,]\d+)?)/);
    const points = Number(String(scored?.[1] ?? "").replace(",", "."));
    const subject = matchDiscipline(t, disciplines);
    if (Number.isFinite(points)) {
      return step("Считаю баллы без записи в ведомость.", "simulate_mark", {
        ...(subject ? { subject } : {}),
        value: points,
        points,
        ...(outOf ? { maxPoints: Number(outOf[2]) } : {}),
      });
    }
  }

  if (/балл/.test(t) && !/поставь|оценк/.test(t)) {
    const subject = matchDiscipline(t, disciplines);
    return step("Смотрю баллы.", "get_grades", subject ? { subject } : {});
  }
  if (/автомат|сколько мне|сколько нужн|сесс|как у меня|как я иду|что нужно/.test(t)) {
    const subject = matchDiscipline(t, disciplines);
    return step("Смотрю сессию.", "get_session_navigator", subject ? { subject } : {});
  }
  if (/оценк|успеваем|зачетк по|зачётк по|ведомост/.test(t)) {
    const subject = matchDiscipline(t, disciplines);
    return step("Открываю оценки.", "get_grades", subject ? { subject } : {});
  }
  if (/задан|домашн|что сдать|что мне сдать|дедлайн|просрочен|лаб/.test(t) && !/поставь|оцен/.test(t)) {
    const bucket = /просроч/.test(t) ? "overdue" : /сданн|что сдал/.test(t) ? "done" : "due";
    const until = deadlineUntil(t);
    const kind = /лаб/.test(t) ? "lab" : undefined;
    return step("Смотрю задания.", "list_homework", { bucket, ...(until ? { until } : {}), ...(kind ? { kind } : {}) });
  }
  if (/сводка по/.test(t)) {
    const subject = matchDiscipline(t, disciplines) ?? t.replace(/.*сводка по\s*/, "");
    return step("Смотрю предмет.", "get_session_navigator", { subject });
  }
  const asked = scheduleAsk(t, disciplines);
  if (asked) return step("Смотрю расписание.", "get_schedule", { ...asked });
  if (/профил|кто я|моя группа|мой групп|номер зачет|номер зачёт|зачетк|зачётк/.test(t)) {
    return step("Открываю профиль.", "get_profile", {});
  }
  if (/регламент|положен|можно ли|как получить|как оформ|правил/.test(t)) {
    return step("Ищу в положении.", "search_regulations", { query: message.trim().slice(0, 180) });
  }
  if (/уведомлен|новост|объявлен/.test(t)) return step("Открываю уведомления.", "open_page", { page: "notifications" });
  if (/что нового|доброе утро|добрый день|добрый вечер|привет/.test(t)) return step("Собираю сводку.", "get_brief", {});
  if (/главн|панель/.test(t)) return step("Открываю главную.", "open_page", { page: "dashboard" });

  if (role === "staff") {
    return say("Могу разобрать входящие, сменить статус заявки или опубликовать объявление.");
  }
  return say("Могу открыть расписание, прикинуть сессию, заказать справку или найти заявку. Например: «что завтра» или «справка для военкомата».");
}

function queueSay(steps: { tool: string }[]) {
  const label = (tool: string) => tool === "teacher_set_mark" ? "поставлю оценку" : tool === "teacher_set_attendance" ? "отмечу явку" : tool === "teacher_grade_homework" ? "оценю работу" : "выполню шаг";
  return `Выполню по очереди: ${steps.map((item, index) => `${index + 1}) ${label(item.tool)}`).join("; ")}.`;
}

function rewriteInherited(head: string, step: { args: Record<string, unknown> }, name: string, value: string) {
  const student = String(step.args.studentName ?? "");
  let next = student ? head.replace(student, name) : head.replace(/поставь\s+[а-яё-]+/i, `поставь ${name}`);
  if (step.args.status) next = next.replace(/(^|\s)[нбНБоОуУ](?=\s|$)/, `$1${value}`);
  else if (step.args.points != null || step.args.value != null) {
    const points = String(step.args.points ?? step.args.value).replace(".", "\\.");
    next = next.replace(new RegExp(`(?<![\\d.])${points}(?![\\d.])`), value);
  }
  return next;
}

const SHARED_TAIL = /(\s+за\s+(?:\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?|\d{1,2}\s+(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-яё]*|сегодня|вчера|завтра|послезавтра)(?:\s+по\s+(?:бд|базам(?:\s+данных)?|прог[а-яё]*|информац[а-яё]*|матан[а-яё]*|[а-яё]{2,}))?)\s*$/i;

function sharedTail(raw: string) {
  const match = raw.match(SHARED_TAIL);
  if (!match || match.index == null) return { core: raw, tail: "" };
  const core = raw.slice(0, match.index).trim();
  if (!/\s+и\s+/i.test(core)) return { core: raw, tail: "" };
  return { core, tail: match[1].trim() };
}

function attachTail(phrase: string, tail: string) {
  if (!tail || /\sза\s+(?:\d{1,2}[./]\d{1,2}|сегодня|вчера|завтра|послезавтра)/i.test(phrase)) return phrase;
  return `${phrase} ${tail}`;
}

const NOT_AN_ACTION = new Set(["get_schedule", "open_page", "list_homework", "get_brief", "get_grades", "get_profile", "search_regulations", "teacher_home", "teacher_list_submissions", "teacher_subject_summary"]);

function partOk(phrase: string, proposal: Proposal | null) {
  const tool = proposal?.steps[0]?.tool ?? "";
  if (!tool || !proposal?.steps.length) return false;
  if (/^(поставь|отметь)/i.test(phrase.trim()) && NOT_AN_ACTION.has(tool)) return false;
  return true;
}

function combineParts(phrases: string[]): Proposal | null {
  const parsed = phrases.map((phrase) => ({ phrase, proposal: parseTeacher(norm(phrase), phrase) }));
  const missed = parsed.filter((item) => !partOk(item.phrase, item.proposal)).map((item) => item.phrase);
  const steps = parsed.filter((item) => partOk(item.phrase, item.proposal)).flatMap((item) => item.proposal?.steps ?? []);
  if (!steps.length && !missed.length) return null;
  if (missed.length) {
    const note = `Не разобрал: ${missed.join("; ")}.`;
    return { say: steps.length > 1 ? `${queueSay(steps)} ${note}` : note, steps };
  }
  if (steps.length >= 2) return { say: queueSay(steps), steps };
  return null;
}

function splitTeacherConjunction(raw: string): Proposal | null {
  if (!/\s+и\s+/i.test(raw)) return null;
  const { core, tail } = sharedTail(raw);
  if (/\s+и\s+(?=поставь|отметь|верни)/i.test(core)) {
    const phrases = core.split(/\s+и\s+(?=поставь|отметь|верни)/i).map((part) => attachTail(part.trim(), tail));
    return combineParts(phrases);
  }
  const mid = core.match(/^(.*\S)\s+и\s+(?!поставьте\b|поставь\b|отметьте\b|отметь\b|верните\b|верни\b)([А-ЯЁа-яё]{3,})\s+(\d+(?:[.,]\d+)?|[нНбБоОуУ])\s*$/i);
  if (!mid) return null;
  const head = mid[1];
  const firstPhrase = attachTail(head, tail);
  const verb = head.match(/^(поставьте|поставь|отметьте|отметь|верните|верни)/i)?.[1] ?? "поставь";
  const probe = !tail ? parseTeacher(norm(firstPhrase), firstPhrase) : null;
  const secondBase = probe && partOk(firstPhrase, probe) ? rewriteInherited(head, probe.steps[0], mid[2], mid[3]) : `${verb} ${mid[2]} ${mid[3]}`;
  return combineParts([firstPhrase, attachTail(secondBase, tail)]);
}

function parseTeacher(t: string, raw: string): Proposal | null {
  const together = splitTeacherConjunction(raw);
  if (together) return together;
  if (/убери\s+оценк|сними\s+оценк|удали\s+оценк/.test(t)) {
    const name = personName(raw);
    const date = journalDate(t);
    const work = parseWorkType(t);
    const discipline = disciplineHint(t);
    if (!name) return say("Чью оценку снять? Назовите студента.");
    return step("Готовлю снятие оценки.", "teacher_clear_mark", {
      studentName: name,
      ...(date ? { date } : {}),
      ...(work ? { workType: work.type } : {}),
      ...(discipline ? { discipline } : {}),
    });
  }
  if (/открой явку|явку группы|открой журнал явки/.test(t)) return step("Открываю явку.", "teacher_open_roll", {});
  if (/пят[её]рк|отличн|(^|[^а-я])зач[её]т([^а-я]|$)/.test(t) && /поставь|оцен/.test(t) && !/-?\d/.test(t)) return say("Сколько из 10?");
  if (/непроверен|на проверк|очередь работ|мои работы/.test(t)) {
    const group = t.match(/[а-яё]{1,3}-\d-\d{2}-\d{2}/i)?.[0]?.toUpperCase();
    return step("Смотрю непроверенные работы.", "teacher_list_submissions", group ? { group } : {});
  }
  if (/пары сегодня|мои группы|что (у меня )?сегодня|мои пары/.test(t)) return step("Смотрю пары на сегодня.", "teacher_home", {});
  const namedGrade = t.match(/поставь\s+([а-яё]{3,})\s+([2-5])/);
  const grade = namedGrade
    ? [namedGrade[0], namedGrade[2], namedGrade[1]] as RegExpMatchArray
    : t.match(/поставь\s*([2-5]).{0,40}?([а-яё]{4,})/i) || t.match(/([а-яё]{4,}).{0,20}?(?:оценк\S*|поставь)\s*([2-5])/i);
  if (/доработ/.test(t) && /верн/.test(t)) {
    const comment = extractComment(raw);
    const bare = norm(raw.replace(/\s*(?:,)?\s*(?:с\s+комментарием|комментарий|коммент(?:арий|ом)?)\s*[:\-—]?[\s\S]*$/i, ""));
    const name = bare.match(/работ[уы]\s+([а-яё]{4,})/)?.[1] ?? personName(bare.replace(/^верн\S*\s+на\s+доработку\s*/, "")) ?? "студент";
    const query = /лаб|индекс/.test(bare) ? "лаб" : "";
    return step("Готовлю возврат на доработку.", "teacher_return_homework", { studentName: name, query, comment });
  }
  if (/отсутств/.test(t)) {
    const name = t.match(/([а-яё]{4,})(?:а|у)?$/i)?.[1] ?? "";
    if (!name || /отсутств/.test(name)) return step("Открываю явку ближайшей пары.", "teacher_open_roll", {});
    return step("Отмечаю отсутствие.", "teacher_mark_absent", { names: [name.replace(/а$/, "").replace(/у$/, "")] });
  }
  if (/сводка по/.test(t)) {
    const discipline = /баз/.test(t) ? "Базы данных" : /програм/.test(t) ? "Программирование" : t.replace(/.*сводка по\s*/, "");
    return step("Собираю сводку.", "teacher_subject_summary", { discipline });
  }
  const grading = gradingCommand(raw, t);
  if (grading) return grading;
  const journal = journalCommand(raw, t);
  if (journal) return journal;
  if (grade && /поставь|оцен/.test(t)) {
    const score = Number(grade[1].length === 1 ? grade[1] : grade[2]);
    const name = (grade[1].length === 1 ? grade[2] : grade[1]).replace(/у$/, "");
    const quoted = raw.match(/«([^»]+)»/)?.[1];
    if (quoted || /лаб|работ|задан/.test(t)) return step("Готовлю оценку за сданную работу.", "teacher_grade_homework", { studentName: name, query: quoted || (/лаб/.test(t) ? "лаб" : ""), score });
    return step("Готовлю оценку в журнал.", "teacher_set_mark", {
      studentName: name,
      ...(disciplineHint(t) ? { discipline: disciplineHint(t) } : {}),
      value: score,
      label: "Текущая",
    });
  }
  if (/выдай|новое задание/.test(t) && /задани/.test(t)) {
    const group = t.match(/[а-яё]{1,4}-\d-\d{2}-\d{2}/i)?.[0]?.toUpperCase() ?? (/юр/.test(t) ? "ЮР-1-26-02" : "БИ-3-26-04");
    const asked = scheduleAsk(t, []);
    const today = moscowToday();
    const delta = (5 - weekdayIndex(today) + 7) % 7 || 7;
    const after = raw.includes(":") ? raw.split(/:/).slice(1).join(":").trim() : "";
    const title = (after || raw).split(/\s+срок\s+\d/i)[0].replace(/,\s*$/, "").replace(/^выдай(те)?\s*(задание\s*)?(группе\s*)?/i, "").trim();
    const named = /баз/.test(t) ? "Базы данных" : /програм/.test(t) ? "Программирование" : /информацион/.test(t) ? "Информационные технологии в юридической деятельности" : "";
    const bare = title.length >= 3 ? title.slice(0, 160) : "Новое задание";
    const withoutDeadline = (after || "").replace(/\s*,?\s*срок\s+\d[\s\S]*$/i, "").trim();
    const description = withoutDeadline.length >= 3 && withoutDeadline !== bare && !/^выдай/i.test(withoutDeadline) ? withoutDeadline.slice(0, 500) : bare;
    return step("Показываю задание перед выдачей.", "teacher_issue_assignment", {
      groupName: group,
      ...(named ? { discipline: named } : {}),
      title: bare,
      description,
      kind: /эссе/.test(t) ? "essay" : /лаб/.test(t) ? "lab" : /чтени/.test(t) ? "reading" : "problem_set",
      deadline: asked?.date ?? addDays(today, delta),
    });
  }
  if (/объявлен/.test(t) && /групп/.test(t)) return step("Открываю объявление группе.", "open_page", { page: "teach_announce" });
  if (/сводк/.test(t)) {
    const discipline = disciplineHint(t) || t.replace(/.*сводк\S*\s+по\s*/, "");
    return step("Собираю сводку.", "teacher_subject_summary", { discipline });
  }
  if (/журнал/.test(t)) {
    const group = t.match(/[а-яё]{1,3}-\d-\d{2}-\d{2}/i)?.[0]?.toUpperCase();
    const discipline = disciplineHint(t);
    return step("Открываю журнал.", "open_page", {
      page: "teach_journal",
      ...(group ? { group } : {}),
      ...(discipline ? { subject: discipline } : {}),
    });
  }
  const asked = scheduleAsk(t);
  if (asked) return step("Смотрю расписание.", "get_schedule", { ...asked });
  return null;
}

function parseStaff(t: string, raw: string): Proposal | null {
  if (/журнал/.test(t)) return step("Открываю журнал.", "open_page", { page: "staff_journal" });
  const published = t.match(/опубликуй объявлени\S*\s*[:\-—]?\s*(.+)/);
  if (published?.[1]) {
    const needle = published[1].slice(0, 12).toLowerCase().replace(/ё/g, "е");
    const start = raw.toLowerCase().replace(/ё/g, "е").indexOf(needle);
    const body = (start >= 0 ? raw.slice(start) : published[1]).trim();
    const title = body.split(/[.!?\n]/)[0].trim().slice(0, 140);
    return step("Показываю объявление перед публикацией.", "staff_publish_announcement", {
      title: title.length >= 3 ? title : body.slice(0, 140),
      body,
    });
  }
  const requestId = extractRequestId(t);
  if (/нов(ые|ых|ая|ую) заяв/.test(t) || /покажи нов/.test(t)) return step("Открываю новые заявки.", "staff_list_inbox", { status: "submitted" });
  if (requestId && /выдай справк|справк\S*\s+по заявк|выда(й|ть) заявк/.test(t)) {
    return step("Нужно подтвердить выдачу справки.", "staff_set_status", { requestId, status: "issued" });
  }
  if (requestId && /в работу|готов|выдан|отклон/.test(t)) {
    const status = t.includes("в работу") ? "in_progress" : t.includes("выдан") ? "issued" : t.includes("готов") ? "ready" : "rejected";
    if (status === "rejected") {
      const comment = raw.replace(/.*заявк\S*\s*№?\s*\d+\s*/i, "").trim();
      if (comment.length < 3) return say("Напишите причину отказа после номера заявки.");
      return step("Нужно подтвердить отказ.", "staff_set_status", { requestId, status, comment });
    }
    return step("Нужно подтвердить смену статуса.", "staff_set_status", { requestId, status });
  }
  if (/входящ|разбери заяв|очередь заявок|новые заяв/.test(t)) return step("Открываю входящие.", "staff_list_inbox", {});
  if (requestId && /разбер|триаж|заявк/.test(t)) return step("Разбираю заявку.", "staff_triage", { requestId });
  return null;
}

function deadlineUntil(t: string) {
  const today = moscowToday();
  if (t.includes("на этой неделе") || t.includes("до конца недели")) {
    const wd = weekdayIndex(today);
    const toSaturday = wd === 0 ? 6 : 6 - wd;
    return addDays(today, toSaturday);
  }
  if (t.includes("до пятницы") || t.includes("на пятницу")) {
    const delta = (5 - weekdayIndex(today) + 7) % 7 || 7;
    return addDays(today, delta);
  }
  const months = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
  const match = t.match(/до\s+(\d{1,2})\s+([а-я]+)/);
  if (!match) return undefined;
  const month = months.findIndex((name) => match[2].startsWith(name));
  if (month < 0) return undefined;
  const year = Number(today.slice(0, 4));
  return `${year}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function parseReminder(t: string): Proposal | null {
  if (!t.includes("напомн")) return null;
  if (/дедлайн/.test(t) && !/(?:в|к)\s*\d/.test(t)) {
    if (/по\s+\S+|баз|матан|програм|линал/.test(t)) {
      const subject = t.match(/по\s+(.+)/)?.[1]?.trim() || "базам данных";
      return step("Ставлю напоминание по заданию.", "remind_deadline", { subject });
    }
    return step("Ставлю напоминание о дедлайне.", "set_reminder", { title: "Дедлайн", day: "tomorrow", time: "09:00" });
  }
  const day = t.includes("послезавтра") ? "day_after" : t.includes("завтра") ? "tomorrow" : t.includes("сегодня") ? "today" : null;
  const timeMatch = t.match(/(?:в|к)\s*(\d{1,2})(?:[:.](\d{2}))?/);
  if (!day || !timeMatch) return say("На когда поставить напоминание? Например: «напомни завтра в 9 сдать работу».");
  const time = `${timeMatch[1].padStart(2, "0")}:${(timeMatch[2] ?? "00").padStart(2, "0")}`;
  let title = t
    .replace(/напомни(те)?/, "")
    .replace(/послезавтра|завтра|сегодня/, "")
    .replace(/(?:в|к)\s*\d{1,2}(?:[:.]\d{2})?/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (title.length < 2) title = "Напоминание";
  else title = title.charAt(0).toUpperCase() + title.slice(1);
  return step("Ставлю напоминание.", "set_reminder", { title, day, time });
}

/** Текст, который человек просит вписать в работу. Без маркера — короткая заготовка. */
export function submissionText(raw: string): string {
  const markers = [/с\s+текстом(?=\s|[:\-—]|$)/i, /с\s+комментарием(?=\s|[:\-—]|$)/i, /напиш(?:и|ите)(?=\s|[:\-—]|$)/i, /комментарий\s*[:\-—]/i];
  for (const marker of markers) {
    const match = marker.exec(raw);
    if (!match || match.index == null) continue;
    let rest = raw.slice(match.index + match[0].length).trim().replace(/^[:\-—]\s*/, "");
    const quoted = rest.match(/^(?:«([^»]+)»|"([^"]+)")/);
    if (quoted) return (quoted[1] ?? quoted[2]).trim();
    rest = rest.split(/\s+(?:и\s+)?сда(?:й|йте)(?=\s|$)/i)[0] ?? rest;
    const text = rest.trim().replace(/[.。]+$/, "");
    if (text.length >= 2) return text;
  }
  const outside = raw.replace(/«[^»]*»/g, " ");
  const afterColon = outside.split(":").slice(1).join(":").trim();
  if (afterColon.length >= 2) return afterColon;
  return "Сдаю работу.";
}

export function extractComment(raw: string): string {
  const text = raw.trim();
  const patterns = [
    /с\s+комментарием\s*[:\-—]?\s*(?:«([^»]+)»|"([^"]+)"|(.+))$/i,
    /комментарий\s*[:\-—]\s*(?:«([^»]+)»|"([^"]+)"|(.+))$/i,
    /коммент(?:арий|ом)?\s*[:\-—]\s*(?:«([^»]+)»|"([^"]+)"|(.+))$/i,
  ];
  for (const pattern of patterns) {
    const value = text.match(pattern)?.slice(1).find((part) => part?.trim());
    if (value) return value.trim();
  }
  return "Нужно доработать.";
}

function gradingCommand(raw: string, t: string): Proposal | null {
  if (!/вес|максимум/.test(t)) return null;
  const work = parseWorkType(t);
  if (!work) return null;
  const weight = t.match(/вес\D+(\d+(?:[.,]\d+)?)/);
  const max = t.match(/максимум\D+(\d+)/);
  if (!weight && !max) return null;
  return step("Меняю систему оценивания. Нужно подтверждение.", "teacher_update_grading", {
    workType: work.type,
    ...(weight ? { weight: Number(weight[1].replace(",", ".")) } : {}),
    ...(max ? { maxPoints: Number(max[1]) } : {}),
    ...(disciplineHint(t) ? { discipline: disciplineHint(t) } : {}),
  });
}

const POINT_WORDS: [RegExp, number][] = [
  [/(^|[^а-я])пол([^а-я]|$)/, 0.5],
  [/(^|[^а-я])ноль([^а-я]|$)/, 0],
  [/(^|[^а-я])один([^а-я]|$)/, 1],
  [/(^|[^а-я])два([^а-я]|$)/, 2],
  [/(^|[^а-я])три([^а-я]|$)/, 3],
  [/(^|[^а-я])четыре([^а-я]|$)/, 4],
  [/(^|[^а-я])пять([^а-я]|$)/, 5],
  [/(^|[^а-я])шесть([^а-я]|$)/, 6],
  [/(^|[^а-я])семь([^а-я]|$)/, 7],
  [/(^|[^а-я])восемь([^а-я]|$)/, 8],
  [/(^|[^а-я])девять([^а-я]|$)/, 9],
  [/(^|[^а-я])десять([^а-я]|$)/, 10],
];

const NAME_STOP = new Set("поставь поставьте оцени оценка оценку убери сними удали баллы балл балла баллов из за работу работу контрольную контрольная лабораторную лабораторная лабу лабы тест тесту вчера сегодня по базам данных программированию проге прога бд предмету неделю прошлой прошлую среду четверг понедельник вторник пятницу субботу этому эту индексы индекс".split(" "));

function personName(raw: string) {
  const cleaned = raw
    .replace(/«[^»]*»/g, " ")
    .replace(/\d+(?:[.,]\d+)?\s*(?:балл[а-яё]*)?\s*из\s*\d+/gi, " ")
    .replace(/\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?/g, " ")
    .replace(/\d{1,2}\s+(?:январ\w*|феврал\w*|март\w*|апрел\w*|ма[йя]\w*|июн\w*|июл\w*|август\w*|сентябр\w*|октябр\w*|ноябр\w*|декабр\w*)(?:\s+\d{4})?/gi, " ")
    .replace(/по\s+(?:бд|базам(?:\s+данных)?|проге|прога|програм[а-яё]*|информац[а-яё]*(?:\s+технолог[а-яё]*)?|матан[а-яё]*)/gi, " ")
    .replace(/(?:в|на)\s+прошл[а-яё]+\s+[а-яё]+/gi, " ")
    .replace(/(?:убери|сними|удали)\s+оценк[а-яё]*/gi, " ");
  const parts = cleaned.split(/[^А-Яа-яЁёA-Za-z]+/).filter(Boolean);
  const kept = parts.filter((word) => {
    const token = norm(word);
    return token.length >= 3 && !NAME_STOP.has(token) && !POINT_WORDS.some(([pattern]) => pattern.test(` ${token} `)) && !/январ|феврал|ноябр|декабр|октябр|сентябр|август|апрел|восемнадцат|девятнадцат|двадцат|понедельник|вторник|четверг|пятниц|суббот|воскресен/.test(token);
  });
  if (!kept.length) return "";
  const secondToken = kept[1] ? norm(kept[1]) : "";
  const given = kept[1] && secondToken.length >= 4 && secondToken.length <= 10 && !/[аы]м$|ого$|ыми$/.test(secondToken) && !NAME_STOP.has(secondToken) && !parseWorkType(secondToken);
  const second = given ? ` ${kept[1]}` : "";
  return `${kept[0]}${second}`;
}

function gradeSlots(raw: string, t: string) {
  const negative = t.match(/(^|[^\d])(-\d+(?:[.,]\d+)?)/);
  if (negative) return { error: "Отрицательные баллы поставить нельзя." as const };
  const numeric = t.match(/(\d+(?:[.,]\d+)?)(?:\s*(?:балл[а-я]*)?\s*из\s*(\d+))?/);
  let points: number | null = null;
  let maxPoints: number | null = null;
  if (numeric && !(numeric.index != null && /[./]/.test(t.slice(Math.max(0, numeric.index - 1), numeric.index + numeric[0].length)) && numeric[1].includes(".") && numeric[1].split(/[.,]/)[1]?.length === 2 && !/балл|из/.test(numeric[0]))) {
    const token = numeric[1];
    const fractional = /[.,]\d$/.test(token);
    const looksLikeDate = !fractional && /^\d{1,2}[./]\d{1,2}$/.test(token) && !/балл|из/.test(numeric[0]);
    if (!looksLikeDate) {
      points = Number(token.replace(",", "."));
      if (numeric[2]) maxPoints = Number(numeric[2]);
    }
  }
  if (points == null) {
    const word = POINT_WORDS.find(([pattern]) => pattern.test(` ${t} `));
    if (word) points = word[1];
  }
  if (points != null && (points < 0 || points > 1000)) return { error: "Баллы от 0 до 1000." as const };
  if (points != null && Math.abs(points * 2 - Math.round(points * 2)) > 1e-6) return { error: "Баллы ставятся с шагом 0,5." as const };
  const name = personName(raw);
  const work = parseWorkType(raw);
  const stripped = points != null && numeric && !/^\d{1,2}[./]\d{1,2}$/.test(numeric[1]) ? t.replace(numeric[0], " ") : t;
  const date = /на прошлой неделе/.test(t) ? undefined : journalDate(stripped);
  const quoted = raw.match(/«([^»]+)»/)?.[1] ?? raw.match(/(?:за|по)\s+((?:лабораторн|контрольн|семинар)[а-яё]*\s*:\s*[a-zа-яё0-9][^.,]{0,40})/i)?.[1];
  const week = /на прошлой неделе/.test(t) ? "prev" as const : undefined;
  return { points, maxPoints, name, work, date, quoted, week };
}

function journalCommand(raw: string, t: string): Proposal | null {
  if (!/поставь|оцен|балл|явк/.test(t) && !parseWorkType(t) && !(disciplineHint(t) && /\d/.test(t))) return null;
  const letter = raw.match(/поставь\s+([а-яё]{3,}(?:\s+[а-яё]{3,})?)\s+([нбоу])(?=\s|$)/i);
  if (letter) {
    const date = journalDate(raw) ?? moscowToday();
    const status = { н: "absent", б: "sick", о: "late", у: "excused" }[letter[2].toLowerCase()] ?? "absent";
    const discipline = disciplineHint(t);
    return step("Отмечаю явку.", "teacher_set_attendance", {
      studentName: letter[1],
      date,
      status,
      present: false,
      ...(discipline ? { discipline } : {}),
    });
  }
  const slots = gradeSlots(raw, t);
  if ("error" in slots) return /поставь|оцен|балл/.test(t) ? say(String(slots.error)) : null;
  if (/оцени/.test(t) && /работ|задан/.test(t) && !slots.work && slots.name) {
    const score = slots.points ?? Number(t.match(/на\s+([2-5])(?!\d)/)?.[1] ?? 0);
    return step("Готовлю оценку за сданную работу.", "teacher_grade_homework", { studentName: slots.name, query: slots.quoted ?? "", score });
  }
  if (slots.points == null || !slots.name) return null;
  const journalQuote = Boolean(slots.quoted && /лаборатор|контрол|семинар|индекс|:/.test(slots.quoted.toLowerCase()));
  const columnTitle = Boolean(slots.quoted && /\d/.test(slots.quoted) && !/:/.test(slots.quoted));
  const submission = !journalQuote && !slots.date && !slots.week && !columnTitle && (slots.work?.type === "lab" || (/работ|задан/.test(t) && !slots.work && !/лаборатор/.test(t)));
  if (submission) {
    const query = slots.quoted || (slots.work?.type === "lab" || /лаб/.test(t) ? "лаб" : "");
    return step("Готовлю оценку за сданную работу.", "teacher_grade_homework", { studentName: slots.name.toLowerCase().replace(/у$/, ""), query, score: slots.points });
  }
  const title = slots.quoted
    ?.replace(/[«»"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^лабораторн[а-яё]*/i, "Лабораторная")
    .replace(/^контрольн[а-яё]*/i, "Контрольная")
    .replace(/^семинар[а-яё]*/i, "Семинар");
  const discipline = disciplineHint(t);
  return step("Готовлю баллы в журнал.", "teacher_set_mark", {
    studentName: slots.name,
    points: slots.points,
    value: slots.points,
    ...(slots.maxPoints != null ? { maxPoints: slots.maxPoints } : {}),
    ...(slots.work ? { workType: slots.work.type, label: slots.work.title ?? WORK_TYPES[slots.work.type].label, title: title ?? slots.work.title } : {}),
    ...(title ? { title, label: title } : {}),
    ...(slots.date ? { date: slots.date } : {}),
    ...(slots.week ? { week: slots.week } : {}),
    ...(discipline ? { discipline } : {}),
    ...(slots.work?.type === "credit" ? { kind: "credit" } : {}),
  });
}

function disciplineHint(t: string) {
  if (/(^|[^а-яё])бд([^а-яё]|$)/.test(t) || /баз/.test(t)) return "Базы данных";
  if (/прог/.test(t)) return "Программирование";
  if (/информац/.test(t)) return "Информационные технологии в юридической деятельности";
  if (/матан|математическ/.test(t)) return "Математический анализ";
  return "";
}

function detectKind(t: string): RequestKind | null {
  if (t.includes("период")) return "period_certificate";
  if (t.includes("об обучен") || (t.includes("справк") && t.includes("обучен"))) return "study_certificate";
  if (t.includes("военкомат")) return "military_certificate";
  if (t.includes("академ")) return "academic_leave";
  if (t.includes("перевод")) return "transfer";
  if (t.includes("материальн")) return "financial_aid";
  if (t.includes("справк")) return "study_certificate";
  if (t.includes("заявлен")) return "free_form";
  return null;
}

function extractRequestId(t: string): number | null {
  const match = t.match(/заявк\S*\s*№?\s*(\d+)|№\s*(\d+)|#(\d+)/);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  return raw ? Number(raw) : null;
}

function step(say: string, tool: string, args: Record<string, unknown>): Proposal {
  return { say, steps: [{ tool, args }] };
}

function say(text: string): Proposal {
  return { say: text, steps: [] };
}
