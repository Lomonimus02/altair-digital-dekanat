import { buildApp } from "./app";
import { getConfig } from "./config";
import { migrate } from "./db/migrate";

const config = getConfig();
if (!config.databaseUrl) {
  console.error("Задайте DATABASE_URL");
  process.exit(1);
}
if (config.production && !process.env.SESSION_SECRET) {
  console.error("В production нужен SESSION_SECRET");
  process.exit(1);
}

await migrate();
const app = await buildApp();
await app.listen({ port: config.port, host: config.host });
console.log(`Альтаир слушает http://${config.host}:${config.port}`);
