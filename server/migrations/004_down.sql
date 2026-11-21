-- Откат журнала. Старые оценки, явка и расписание остаются.
DROP INDEX IF EXISTS marks_student_column;
ALTER TABLE marks DROP COLUMN IF EXISTS column_id, DROP COLUMN IF EXISTS comment, DROP COLUMN IF EXISTS teacher_id, DROP COLUMN IF EXISTS updated_at;
ALTER TABLE attendance DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS comment;
DROP TABLE IF EXISTS lesson_topics, journal_columns;
