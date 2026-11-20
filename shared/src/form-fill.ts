/** Поля настоящей формы. Ключи совпадают с data-agent-field. */
export function formFill(tool: string, args: Record<string, unknown>): Record<string, string> {
  const text = (value: unknown) => (value == null ? "" : String(value));
  if (tool === "teacher_issue_assignment") {
    return {
      group: text(args.groupName),
      discipline: text(args.discipline),
      title: text(args.title),
      description: text(args.description),
      kind: text(args.kind),
      deadline: text(args.deadline),
    };
  }
  if (tool === "create_request") {
    return { kind: text(args.kind), purpose: text(args.purpose), comment: text(args.comment) };
  }
  if (tool === "submit_homework") return { "homework-body": text(args.body) };
  if (tool === "staff_publish_announcement") return { "announce-title": text(args.title), "announce-body": text(args.body) };
  return {};
}

export function formMatches(state: Record<string, string>, expected: Record<string, string>) {
  return Object.entries(expected).filter(([, value]) => value !== "").every(([key, value]) => state[key] === value);
}
