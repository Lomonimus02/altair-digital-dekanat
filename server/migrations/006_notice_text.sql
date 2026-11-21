ALTER TABLE assignments ADD COLUMN IF NOT EXISTS column_id integer;

UPDATE notifications
SET body = regexp_replace(body, '(\d{4})-(\d{2})-(\d{2})', '\3.\2', 'g')
WHERE body ~ '\d{4}-\d{2}-\d{2}';

UPDATE notifications
SET body = 'Баллы выставлены',
    title = regexp_replace(title, '^Оценка за «([^»]+)»: [0-5]$', '\1')
WHERE title ~ '^Оценка за «.+»: [0-5]$';
