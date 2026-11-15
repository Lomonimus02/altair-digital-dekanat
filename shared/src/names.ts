function norm(value: string) {
  return value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

/** Снимает падеж: Сорокину, Сорокина и Сорокин сходятся в одном корне. */
export function surnameStem(raw: string) {
  const word = norm(raw).split(/[^а-яёa-z]+/).find((part) => part.length >= 4) ?? norm(raw);
  return word.replace(/(ами|ями|ого|ему|ому|ыми|ими|ой|ей|ый|ий|ая|ую|ом|ем|ах|ях|ых|ам|ям|у|ю|а|я|е|ы|и)$/u, "");
}

/** Громов Артём Сергеевич → Громову Артёму Сергеевичу. */
export function toDative(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .map((part, index) => declineDative(part, index))
    .join(" ");
}

function declineDative(word: string, index: number): string {
  if (/(ович|евич|ич)$/u.test(word)) return `${word}у`;
  if (/(овна|евна|ична)$/u.test(word)) return `${word.slice(0, -1)}е`;
  if (index === 0 && /а$/u.test(word)) return `${word.slice(0, -1)}ой`;
  if (/ия$/u.test(word)) return `${word.slice(0, -1)}и`;
  if (/[ая]$/u.test(word)) return `${word.slice(0, -1)}е`;
  if (/й$/u.test(word)) return `${word.slice(0, -1)}ю`;
  if (/ь$/u.test(word)) return `${word.slice(0, -1)}ю`;
  if (/[бвгджзклмнпрстфхцчшщ]$/iu.test(word)) return `${word}у`;
  return word;
}

export function samePerson(query: string, fullName: string) {
  const left = surnameStem(query);
  const right = surnameStem(fullName);
  if (left.length < 4 || right.length < 4) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}
