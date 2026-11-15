import { STATUS_LABEL, kindMeta, type RequestStatus } from "../../shared/src/domain";

export interface Triage {
  category: string;
  summary: string;
  suggestedReply: string;
  suggestedStatus: "in_progress" | "ready" | "rejected";
}

export function triageRequest(input: {
  id: number;
  kind: string;
  title: string;
  purpose?: string | null;
  body?: string | null;
  status: RequestStatus;
  studentName: string;
  groupName?: string | null;
}): Triage {
  const meta = kindMeta(input.kind);
  const who = `${input.studentName}${input.groupName ? `, ${input.groupName}` : ""}`;
  const purpose = input.purpose ? ` Назначение: ${input.purpose}.` : "";
  if (input.kind === "military_certificate") {
    return {
      category: "Справка",
      summary: `${who} просит справку для военкомата.${purpose}`,
      suggestedReply: "Справку для военкомата подготовим в течение двух рабочих дней. Проверьте ФИО и группу перед выдачей.",
      suggestedStatus: input.status === "submitted" ? "in_progress" : "ready",
    };
  }
  if (input.kind === "academic_leave") {
    const hasDoc = /документ|справк|прилож/i.test(`${input.body ?? ""} ${input.purpose ?? ""}`);
    return {
      category: "Академический отпуск",
      summary: `${who} просит академический отпуск.${purpose}${hasDoc ? " В тексте есть упоминание документов." : " Подтверждающие документы в тексте не названы."}`,
      suggestedReply: hasDoc
        ? "Заявление берём в работу и сверяем основание с п. 4.2 Положения об академическом отпуске."
        : "По п. 4.2 нужны подтверждающие документы. Приложите основание и подайте заявление снова.",
      suggestedStatus: hasDoc || input.status !== "submitted" ? "in_progress" : "rejected",
    };
  }
  if (meta?.group === "certificate") {
    return {
      category: "Справка",
      summary: `${who}: ${input.title}.${purpose}`,
      suggestedReply: "Проверьте сведения и отметьте справку готовой, когда бланк сформирован.",
      suggestedStatus: "ready",
    };
  }
  return {
    category: "Заявление",
    summary: `${who}: ${input.title}.${purpose} Сейчас статус «${STATUS_LABEL[input.status]}».`,
    suggestedReply: "Заявление принято в работу. Ответ появится в карточке заявки.",
    suggestedStatus: input.status === "submitted" ? "in_progress" : "ready",
  };
}
