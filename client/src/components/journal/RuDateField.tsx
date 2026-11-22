import { useLayoutEffect, useRef, type ClipboardEvent } from "react";
import { applyDateInput, pasteRuDate } from "@shared/dates";

/** Поле дд.мм.гггг: набор только из цифр, короткий год и ISO — только вставка. */
export function RuDateField({ label, caption, value, onChange, required = false, block = false }: {
  label: string;
  caption?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  block?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const composing = useRef(false);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field || caret.current == null || document.activeElement !== field) return;
    field.setSelectionRange(caret.current, caret.current);
  }, [value]);
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const data = event.clipboardData;
    const text = data?.getData("text/plain") || data?.getData("text") || "";
    if (!text.trim()) return;
    event.preventDefault();
    const pasted = pasteRuDate(text);
    caret.current = pasted.length;
    onChange(pasted);
  };
  return (
    <label className={block ? "block text-sm font-semibold" : "text-sm font-semibold"}>
      {caption ?? label}
      <input
        ref={ref}
        className="field mt-1"
        lang="ru"
        inputMode="numeric"
        autoComplete="off"
        placeholder="дд.мм.гггг"
        aria-label={label}
        value={value}
        required={required}
        onPaste={onPaste}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={(event) => {
          composing.current = false;
          const next = event.currentTarget.value;
          const applied = applyDateInput(value, next, next.length);
          caret.current = applied.caret;
          onChange(applied.value);
        }}
        onChange={(event) => {
          const native = event.nativeEvent;
          if (composing.current || (native instanceof InputEvent && native.isComposing)) {
            onChange(event.target.value);
            return;
          }
          const next = event.target.value;
          const start = event.target.selectionStart ?? next.length;
          const applied = applyDateInput(value, next, start);
          caret.current = applied.caret;
          onChange(applied.value);
        }}
      />
    </label>
  );
}
