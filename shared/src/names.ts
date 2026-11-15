function norm(value: string) {
  return value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

/** Снимает падеж: Сорокину, Сорокина и Сорокин сходятся в одном корне. */
export function surnameStem(raw: string) {
  const word = norm(raw).split(/[^а-яёa-z]+/).find((part) => part.length >= 4) ?? norm(raw);
  return word.replace(/(ами|ями|ого|ему|ому|ыми|ими|ой|ей|ый|ий|ая|ую|ом|ем|ах|ях|ых|ам|ям|у|ю|а|я|е|ы|и)$/u, "");
}

export function samePerson(query: string, fullName: string) {
  const left = surnameStem(query);
  const right = surnameStem(fullName);
  if (left.length < 4 || right.length < 4) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}
