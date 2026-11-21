import type { UiDirective } from "@shared/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "./api";
import { applyDirectives } from "./theme";

export function useAction() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return async function run<T extends { ui?: UiDirective[]; summary?: string; undoOffer?: { auditId: number; label: string } }>(action: string, args: Record<string, unknown> = {}) {
    const response = await api<T>("/api/actions", { method: "POST", body: JSON.stringify({ action, args }) });
    applyDirectives(response.ui, navigate, queryClient);
    if (response.undoOffer) {
      toast(action === "mark_notifications_read" ? "Прочитано" : (response.summary ?? "Готово"), {
        action: {
          label: "Отменить",
          onClick: () => void api("/api/actions", { method: "POST", body: JSON.stringify({ action: "undo", args: { auditId: response.undoOffer!.auditId } }) }).then((next) => {
            applyDirectives((next as { ui?: UiDirective[] }).ui, navigate, queryClient);
            toast("Отменил");
          }),
        },
      });
    }
    return response;
  };
}
