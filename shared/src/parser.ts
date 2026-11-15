import type { Proposal, RequestKind, Role } from "./domain";
import { addDays, moscowToday, weekdayIndex } from "./dates";

const ALIASES: [string, string][] = [
  ["матан", "математический анализ"],
  ["матанализ", "математический анализ"],
  ["математическ", "математический анализ"],
  ["линал", "линейная алгебра"],
  ["линейн", "линейная алгебра"],
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
    if (q.includes(alias)) {
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

  if (role === "staff") {
    const staff = parseStaff(t, message);
    if (staff) return staff;
  }
  if (role === "teacher") {
    const taught = parseTeacher(t, message);
    if (taught) return taught;
  }

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

  if (/сда(й|ть)/.test(t) && (/задани/.test(t) || /«/.test(message))) {
    const quoted = message.match(/«([^»]+)»/);
    const body = (quoted ? message.split(/»\s*:/).slice(1).join(":") : message.split(":").slice(1).join(":")).trim() || "Сдаю работу.";
    const subject = quoted?.[1] ?? message.replace(/^[\s\S]*?по\s+/i, "").split(":")[0].trim();
    return step("Готовлю сдачу. Её нужно подтвердить.", "submit_homework", { subject, body });
  }

  if (/справк|заявлен|академ|военкомат|материальн|перевод|закаж|подать заяв|нужн/.test(t) && detectKind(t)) {
    const kind = detectKind(t)!;
    const purpose = t.includes("военкомат") ? "Для предоставления в военный комиссариат" : undefined;
    return step("Собрал заявление. Его нужно подтвердить.", "create_request", { kind, ...(purpose ? { purpose } : {}) });
  }

  if (/если .*получ|если постав|если будет оценк/.test(t)) {
    const valueMatch = t.match(/(\d)\b/);
    const value = valueMatch ? Number(valueMatch[1]) : null;
    const subject = matchDiscipline(t, disciplines);
    if (value != null && value >= 2 && value <= 5 && subject) {
      return step("Считаю без записи в ведомость.", "simulate_mark", { subject, value });
    }
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
  if (/расписан|пары|занят|что у меня|что завтра|что сегодня|послезавтра|следующ(ая|ую) недел|прошл(ая|ую) недел/.test(t)) {
    return step("Смотрю расписание.", "get_schedule", { when: detectWhen(t) });
  }
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

function parseTeacher(t: string, raw: string): Proposal | null {
  if (/непроверен|на проверк|очередь работ|мои работы/.test(t)) {
    const group = t.match(/[а-яё]{1,3}-\d-\d{2}-\d{2}/i)?.[0]?.toUpperCase();
    return step("Смотрю непроверенные работы.", "teacher_list_submissions", group ? { group } : {});
  }
  if (/пары сегодня|мои группы|что (у меня )?сегодня|мои пары/.test(t)) return step("Смотрю пары на сегодня.", "teacher_home", {});
  const grade = t.match(/поставь\s*([2-5]).{0,40}?([а-яё]{4,})/i) || t.match(/([а-яё]{4,}).{0,20}?(?:оценк\S*|поставь)\s*([2-5])/i);
  if (/доработ/.test(t) && /верн/.test(t)) {
    const comment = extractComment(raw);
    const bare = norm(raw.replace(/\s*(?:,)?\s*(?:с\s+комментарием|комментарий|коммент(?:арий|ом)?)\s*[:\-—]?[\s\S]*$/i, ""));
    const name = bare.match(/работ[уы]\s+([а-яё]{4,})/)?.[1] ?? bare.match(/(сорокин\w*|волков\w*|громов\w*)/)?.[1] ?? "студент";
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
  if (/выдай|новое задание|задание по/.test(t)) {
    const discipline = /баз/.test(t) ? "Базы данных" : /програм/.test(t) ? "Программирование" : "Информационные технологии в юридической деятельности";
    const group = /юр|информацион/.test(t) ? "ЮР-1-26-02" : "БИ-3-26-04";
    const today = moscowToday();
    const delta = (5 - weekdayIndex(today) + 7) % 7 || 7;
    const titleMatch = raw.replace(/выдай(те)?\s*/i, "").trim();
    const title = (titleMatch.slice(0, 80) || `Задание по ${discipline}`).replace(/\s+на пятниц.*/i, "");
    return step("Показываю задание перед выдачей.", "teacher_issue_assignment", {
      groupName: group,
      discipline: /баз/.test(t) || /програм/.test(t) ? discipline : "Базы данных",
      title: title.length >= 3 ? title : `Задание по ${discipline}`,
      description: raw.trim().slice(0, 500),
      kind: /лаб/.test(t) ? "lab" : "problem_set",
      deadline: addDays(today, delta),
    });
  }
  if (/объявлен/.test(t) && /групп/.test(t)) return step("Открываю объявление группе.", "open_page", { page: "teach_announce" });
  if (/журнал/.test(t)) {
    const group = t.match(/[а-яё]{1,3}-\d-\d{2}-\d{2}/i)?.[0]?.toUpperCase();
    const discipline = disciplineHint(t);
    return step("Открываю журнал.", "open_page", {
      page: "teach_journal",
      ...(group ? { group } : {}),
      ...(discipline ? { subject: discipline } : {}),
    });
  }
  return null;
}

function parseStaff(t: string, raw: string): Proposal | null {
  const published = t.match(/опубликуй объявлени\S*\s*[:\-—]?\s*(.+)/);
  if (published?.[1]) {
    const body = raw.slice(raw.toLowerCase().indexOf(published[1].slice(0, 12))).trim() || published[1];
    const title = body.split(/[.!?\n]/)[0].trim().slice(0, 140);
    return step("Показываю объявление перед публикацией.", "staff_publish_announcement", {
      title: title.length >= 3 ? title : body.slice(0, 140),
      body,
    });
  }
  const requestId = extractRequestId(t);
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

function disciplineHint(t: string) {
  if (/баз/.test(t)) return "базы данных";
  if (/програм/.test(t)) return "программирование";
  if (/информац/.test(t)) return "информационные технологии";
  if (/матан|математическ/.test(t)) return "математический анализ";
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

function detectWhen(t: string) {
  if (t.includes("послезавтра")) return "day_after";
  if (t.includes("завтра")) return "tomorrow";
  if (t.includes("сегодня")) return "today";
  if (t.includes("следующ")) return "next_week";
  if (t.includes("прошл")) return "prev_week";
  return "week";
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
