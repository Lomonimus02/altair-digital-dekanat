# Сторонние компоненты и лицензии

Собственный код «Альтаира» — MIT (см. `LICENSE`). Ниже — всё стороннее, что попадает в собранный кабинет, сервер или PDF. Все лицензии разрешают такое использование.

## Шрифты

| Что | Где | Лицензия |
| --- | --- | --- |
| Manrope (`@fontsource/manrope`) | интерфейс | SIL Open Font License 1.1 |
| Unbounded (`@fontsource/unbounded`) | заголовки | SIL Open Font License 1.1 |
| Noto Sans (`server/assets/fonts`) | PDF справок | SIL Open Font License 1.1 (`server/assets/fonts/OFL-NotoSans.txt`) |

## Иконки и изображения

| Что | Лицензия |
| --- | --- |
| Lucide (`lucide-react`) — все иконки интерфейса | ISC |
| Логотип-звезда «Альтаир», favicon, иконки PWA (`client/public`, `scripts/make-icons.mjs`) | собственные, нарисованы в коде, MIT вместе с проектом |

Фотографий и стоковых картинок нет. Официальные логотипы и гербы вузов не используются.

## Библиотеки интерфейса (попадают в бандл)

| Пакет | Лицензия |
| --- | --- |
| react, react-dom | MIT |
| react-router-dom | MIT |
| @tanstack/react-query | MIT |
| @radix-ui/* (dialog, dropdown-menu, label, scroll-area, separator, slot, switch, tabs, tooltip) | MIT |
| framer-motion | MIT |
| sonner | MIT |
| clsx, tailwind-merge | MIT |
| class-variance-authority | Apache-2.0 |
| tailwindcss (стили на этапе сборки) | MIT |
| @mlc-ai/web-llm (модель в браузере, по желанию) | Apache-2.0 |

## Сервер

| Пакет | Лицензия |
| --- | --- |
| fastify, @fastify/cookie, @fastify/helmet, @fastify/static | MIT |
| drizzle-orm | Apache-2.0 |
| pg | MIT |
| zod | MIT |
| pdf-lib, @pdf-lib/fontkit | MIT |
| qrcode | MIT |
| dotenv | BSD-2-Clause |

## Инструменты сборки и тестов (в кабинет не попадают)

vite, @vitejs/plugin-react, esbuild, typescript (Apache-2.0), tsx, vitest, happy-dom, @testing-library/*, playwright-core (Apache-2.0), postcss, autoprefixer, concurrently — MIT, если не указано иное.

## Языковые модели (не входят в репозиторий)

Браузер может по желанию пользователя скачать веса с Hugging Face через WebLLM:

| Модель | Лицензия |
| --- | --- |
| Qwen2.5-0.5B-Instruct, Qwen2.5-1.5B-Instruct (режим по умолчанию) | Apache-2.0 |
| Qwen2.5-3B-Instruct (режим «качество») | Qwen Research License — некоммерческое использование |

Без модели кабинет работает полностью: фразы разбирает детерминированный разборщик на сервере. Ключей облачных моделей в коде и в браузере нет.
