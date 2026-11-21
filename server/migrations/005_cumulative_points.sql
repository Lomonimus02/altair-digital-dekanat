-- Накопительные баллы. Старые value и max_score не удаляем.
-- Соответствие старой отметки баллам при максимуме 10:
-- 5 → 10, 4 → 8, 3 → 6, 2 → 4, 1 → 2, 0 → 0, зачёт → 10, незачёт → 0.

ALTER TABLE journal_columns ADD COLUMN IF NOT EXISTS max_points integer;
UPDATE journal_columns SET max_points = 10 WHERE max_points IS NULL;
ALTER TABLE journal_columns ALTER COLUMN max_points SET DEFAULT 10;
ALTER TABLE journal_columns ALTER COLUMN max_points SET NOT NULL;
ALTER TABLE journal_columns DROP CONSTRAINT IF EXISTS journal_columns_max_points_check;
ALTER TABLE journal_columns ADD CONSTRAINT journal_columns_max_points_check CHECK (max_points BETWEEN 1 AND 1000);
ALTER TABLE journal_columns DROP CONSTRAINT IF EXISTS journal_columns_weight_check;
ALTER TABLE journal_columns ADD CONSTRAINT journal_columns_weight_check CHECK (weight > 0 AND weight <= 20);

ALTER TABLE marks ADD COLUMN IF NOT EXISTS points numeric(6,1);
UPDATE marks SET points = CASE
  WHEN kind = 'credit' AND COALESCE(value, 0) >= 1 THEN 10
  WHEN kind = 'credit' THEN 0
  WHEN value = 5 THEN 10
  WHEN value = 4 THEN 8
  WHEN value = 3 THEN 6
  WHEN value = 2 THEN 4
  WHEN value = 1 THEN 2
  WHEN value = 0 THEN 0
  ELSE points
END
WHERE points IS NULL AND value IS NOT NULL;

CREATE TABLE IF NOT EXISTS grading_schemes (
  id serial PRIMARY KEY,
  group_name text NOT NULL,
  discipline text NOT NULL,
  defaults jsonb NOT NULL,
  excellent numeric(5,2) NOT NULL DEFAULT 85,
  good numeric(5,2) NOT NULL DEFAULT 70,
  satisfactory numeric(5,2) NOT NULL DEFAULT 55,
  updated_by integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_name, discipline)
);
