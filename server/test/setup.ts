import dotenv from "dotenv";
import { afterAll, beforeAll, beforeEach } from "vitest";

dotenv.config();
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://dekanat:dekanat@127.0.0.1:5432/dekanat_test";
process.env.SESSION_SECRET = "test-secret-altair-test-secret";
process.env.COOKIE_SECURE = "false";
process.env.ENABLE_CLOUD_LLM = "false";
delete process.env.LOCAL_LLM_URL;
delete process.env.PUBLIC_BASE_URL;

beforeEach(async () => {
  const { resetRateLimits } = await import("../src/app");
  resetRateLimits();
});

beforeAll(async () => {
  const { migrate } = await import("../src/db/migrate");
  await migrate();
}, 60_000);

afterAll(async () => {
  const { closePool } = await import("../src/db/client");
  await closePool();
});
