DROP TABLE IF EXISTS grading_schemes;
ALTER TABLE marks DROP COLUMN IF EXISTS points;
ALTER TABLE journal_columns DROP CONSTRAINT IF EXISTS journal_columns_max_points_check;
ALTER TABLE journal_columns DROP COLUMN IF EXISTS max_points;
ALTER TABLE journal_columns DROP CONSTRAINT IF EXISTS journal_columns_weight_check;
ALTER TABLE journal_columns ADD CONSTRAINT journal_columns_weight_check CHECK (weight > 0 AND weight <= 5);
