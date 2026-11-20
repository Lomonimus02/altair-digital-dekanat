import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { registry } from "../../shared/src/registry";
import { UI_ACTIONS } from "../../shared/src/ui-actions";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return full.endsWith(".tsx") || full.endsWith(".ts") ? [full] : [];
  });
}

it("у каждой кнопки интерфейса есть команда агента", () => {
  const source = files(path.resolve("client/src")).map((file) => readFileSync(file, "utf8")).join("\n");
  const used = [...source.matchAll(/data-agent-action="([^"]+)"/g)].map((match) => match[1]);
  const wired = [...source.matchAll(/action: "([^"]+)"/g)].map((match) => match[1]);
  const unique = [...new Set(used)];
  const known = new Set(UI_ACTIONS.map((item) => item.id));
  const tools = new Set(registry.map((item) => item.name));
  expect(source.includes("data-agent-action={action}") && source.includes("data-agent-action={link.action}"), "кнопки навигации не отдают действие").toBe(true);
  expect(unique.filter((id) => !known.has(id)), "кнопка без реестра").toEqual([]);
  expect(UI_ACTIONS.map((item) => item.id).filter((id) => !used.includes(id) && !wired.includes(id)), "действие без кнопки").toEqual([]);
  expect(UI_ACTIONS.filter((item) => item.tool && !tools.has(item.tool as never)).map((item) => item.id), "нет обработчика").toEqual([]);
});
