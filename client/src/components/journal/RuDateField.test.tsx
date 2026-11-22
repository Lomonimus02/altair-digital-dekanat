/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { RuDateField } from "./RuDateField";

afterEach(cleanup);

function Field() {
  const [value, setValue] = useState("");
  return <RuDateField label="С" value={value} onChange={setValue} />;
}

function inputOf(): HTMLInputElement {
  return screen.getByLabelText("С") as HTMLInputElement;
}

function writeValue(input: HTMLInputElement, next: string, caret: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, next);
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
}

function typeDigit(input: HTMLInputElement, digit: string) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  writeValue(input, `${input.value.slice(0, start)}${digit}${input.value.slice(end)}`, start + 1);
}

function backspace(input: HTMLInputElement) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  if (start !== end) {
    writeValue(input, `${input.value.slice(0, start)}${input.value.slice(end)}`, start);
    return;
  }
  if (start === 0) return;
  writeValue(input, `${input.value.slice(0, start - 1)}${input.value.slice(start)}`, start - 1);
}

function paste(input: HTMLInputElement, text: string) {
  const data = new DataTransfer();
  data.setData("text/plain", text);
  data.setData("text", text);
  act(() => {
    input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
}

describe("маска даты в поле", () => {
  it("набирает 01112026 по цифре и не раздувает год", () => {
    render(<Field />);
    const input = inputOf();
    input.focus();
    for (const digit of "01112026") typeDigit(input, digit);
    expect(input.value).toBe("01.11.2026");
    expect(input.selectionStart).toBe(input.value.length);
  });

  it("backspace с конца не зацикливает 2020, а по точке снимает цифру перед ней", () => {
    render(<Field />);
    const input = inputOf();
    input.focus();
    for (const digit of "01112026") typeDigit(input, digit);
    backspace(input);
    expect(input.value).toBe("01.11.202");
    backspace(input);
    expect(input.value).toBe("01.11.20");
    typeDigit(input, "2");
    typeDigit(input, "6");
    expect(input.value).toBe("01.11.2026");
    input.setSelectionRange(3, 3);
    backspace(input);
    expect(input.value).toBe("01.12.026");
    expect(input.selectionStart).toBe(1);
  });

  it("правка месяца не превращает 11 в 01 и не сдвигает год", () => {
    render(<Field />);
    const input = inputOf();
    input.focus();
    for (const digit of "01112026") typeDigit(input, digit);
    input.setSelectionRange(4, 4);
    backspace(input);
    expect(input.value).not.toBe("01.01.2026");
    expect(input.value).toBe("01.12.026");
    input.setSelectionRange(0, input.value.length);
    backspace(input);
    for (const digit of "01112026") typeDigit(input, digit);
    input.setSelectionRange(4, 4);
    typeDigit(input, "5");
    expect(input.value).toBe("01.15.2026");
    expect(input.selectionStart).toBe("01.15".length);
  });

  it("во время набора IME маска ждёт compositionend", () => {
    render(<Field />);
    const input = inputOf();
    input.focus();
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    for (const digit of "01112026") {
      const next = `${input.value}${digit}`;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, next);
      const event = new InputEvent("input", { bubbles: true, data: digit, inputType: "insertText" });
      Object.defineProperty(event, "isComposing", { value: true });
      input.dispatchEvent(event);
    }
    expect(input.value).toBe("01112026");
    fireEvent.compositionEnd(input, { data: "01112026" });
    expect(input.value).toBe("01.11.2026");
  });

  it("вставка ISO, короткого года и цифр становится дд.мм.гггг", () => {
    render(<Field />);
    const input = inputOf();
    input.focus();
    paste(input, "2026-11-01");
    expect(input.value).toBe("01.11.2026");
    paste(input, "3.11.26");
    expect(input.value).toBe("03.11.2026");
    paste(input, "17/11/2026");
    expect(input.value).toBe("17.11.2026");
    paste(input, "25112026");
    expect(input.value).toBe("25.11.2026");
  });
});
