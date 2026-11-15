# Деплой

Один процесс Node 22 отдаёт собранный интерфейс и API. Память процесса — около 200 МБ, без модели: она работает в браузере. PostgreSQL 16 ставится отдельно, системным пакетом.

Архив `altair-release.tar.gz` уже содержит сборку. На сервере ничего компилировать не нужно.

## Команды

Из каталога, куда распакован архив:

```bash
tar -xzf altair-release.tar.gz
cd altair
npm ci --omit=dev
cp .env.example .env
npm run migrate
npm run seed
npm start
```

Перед `npm start` откройте `.env` и задайте базу, секрет и, если стоите за Caddy, три флага прокси (ниже).

| Команда | Что делает |
| --- | --- |
| `npm ci --omit=dev` | Ставит только боевые зависимости по lockfile. TypeScript, Vite и tsx не нужны. |
| `npm run migrate` | `node --env-file-if-exists=.env server/dist/migrate.js` — SQL из `server/migrations`. Повтор безопасен и ничего не удаляет. |
| `npm run seed:homework` | `node --env-file-if-exists=.env server/dist/seed-homework.js` — преподаватель `orlov.pn`, демо-задания и одногруппники. Повтор не затирает уже созданные работы и пользователей. |
| `npm run seed:classmates` | `node --env-file-if-exists=.env server/dist/seed-homework.js --classmates` — только 10 вымышленных одногруппников в БИ-3-26-04 и ЮР-1-26-02, с оценкой, явкой и частью работ. Существующих пользователей не меняет. |
| `npm start` | `NODE_ENV=production node --env-file-if-exists=.env server/dist/index.js` |

`npm run seed` пересоздаёт демо-пользователей, оценки и заявки. На живой базе, где данные нужно сохранить, его не запускать. Для уже развёрнутого кабинета: `npm run migrate`, затем `npm run seed:homework`. Если задания уже есть и нужны только одногруппники в журнале: `npm run seed:classmates`. Обе команды идемпотентны и ничего не удаляют.

Если у Сорокина на «Лабораторная: SELECT» остался комментарий «м добавь ER-диаграмму», это разовый сбой старого разбора. Новая миграция не нужна. Преподаватель может исправить текст на карточке работы кнопкой «Сохранить комментарий», либо выполнить один раз:

```sql
UPDATE submissions AS s
SET teacher_comment = 'добавь ER-диаграмму'
FROM assignments AS a, users AS u
WHERE s.assignment_id = a.id
  AND s.student_id = u.id
  AND u.login = 'sorokin.mo'
  AND a.title = 'Лабораторная: SELECT'
  AND s.teacher_comment LIKE 'м %';
```

Порт и адрес:

- `PORT` — порт процесса. В архиве по умолчанию `4317`.
- `HOST` — интерфейс. За прокси на той же машине ставьте `127.0.0.1`. Если процесс должен слушать снаружи без прокси, `0.0.0.0`.

Проверка: `curl -s http://127.0.0.1:4317/api/health` отвечает `{"ok":true}`.

## Переменные

| Переменная | Зачем |
| --- | --- |
| `DATABASE_URL` | PostgreSQL, например `postgres://dekanat:пароль@127.0.0.1:5432/dekanat` |
| `SESSION_SECRET` | длинная случайная строка, обязательна в production |
| `COOKIE_SECURE` | `true` за HTTPS |
| `TRUST_PROXY` | `true` за обратным прокси |
| `PORT` | порт Node, по умолчанию 4317 |
| `HOST` | адрес прослушивания |
| `PUBLIC_BASE_URL` | абсолютный https-адрес без слэша, попадает в QR справки |
| `LOCAL_LLM_URL` | необязательный свой Ollama / llama.cpp. На машине 1 ГБ не включайте |
| `LOCAL_LLM_MODEL` | например `qwen2.5:3b` |
| `LOCAL_LLM_API_KEY` | если локальный endpoint просит ключ |
| `ENABLE_CLOUD_LLM` | оставьте пустым или `false` |

## База

```bash
sudo -u postgres psql -c "CREATE USER dekanat WITH PASSWORD 'замените';"
sudo -u postgres psql -c "CREATE DATABASE dekanat OWNER dekanat;"
```

Пользователь `dekanat` должен владеть базой, чтобы миграции создавали таблицы.

## Caddy

Приложение говорит по HTTP. TLS завершает Caddy. Сессионная cookie с `COOKIE_SECURE=true` уходит только по HTTPS, поэтому без прокси браузер её отвергнет. `TRUST_PROXY=true` заставляет Fastify верить `X-Forwarded-Proto` и `X-Forwarded-For`, которые Caddy ставит сам: иначе cookie считается небезопасной, а лимит входа видит адрес прокси.

В `.env` за Caddy:

```
HOST=127.0.0.1
PORT=4317
COOKIE_SECURE=true
TRUST_PROXY=true
PUBLIC_BASE_URL=https://dekanat.example
```

Caddyfile:

```
dekanat.example {
	reverse_proxy 127.0.0.1:4317
}
```

Поток уведомлений — длинный ответ без буфера. В Caddy 2 `reverse_proxy` не буферизует тело по умолчанию, отдельно выключать не нужно.

## Модель

Основной путь — WebLLM в браузере (Qwen2.5 1.5B, запасной 0.5B, по желанию 3B). Веса качаются на устройство один раз. Серверу они не нужны и в архив не входят.

`LOCAL_LLM_URL` — запасной самохостинг на другой машине.
