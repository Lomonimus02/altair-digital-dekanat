export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function notFound(message = "Не найдено") {
  return new HttpError(404, "not_found", message);
}

export function forbidden(message = "Недостаточно прав") {
  return new HttpError(403, "forbidden", message);
}

export function badRequest(message: string) {
  return new HttpError(400, "bad_request", message);
}
