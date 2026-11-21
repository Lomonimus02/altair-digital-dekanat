ALTER TABLE submissions
  ALTER COLUMN score TYPE numeric(6,1)
  USING score::numeric;

UPDATE notifications n
SET
  kind = 'grade',
  title = 'Баллы: ' || src.work,
  body = src.shown || ' из ' || src.max_points::text
FROM (
  SELECT DISTINCT ON (n.id)
    n.id,
    COALESCE(c.title, m.label) AS work,
    CASE
      WHEN m.points = trunc(m.points) THEN trunc(m.points)::int::text
      ELSE replace(to_char(m.points, 'FM999990.0'), '.', ',')
    END AS shown,
    COALESCE(c.max_points, 10) AS max_points
  FROM notifications n
  JOIN marks m ON m.student_id = n.user_id AND m.points IS NOT NULL
  LEFT JOIN journal_columns c ON c.id = m.column_id
  WHERE (
      n.href ~ ('focus=' || m.id::text || '($|&)')
      OR (
        (n.body = 'Баллы выставлены' OR (n.kind = 'homework' AND n.body ~ 'из .+ балл'))
        AND (n.title = m.label OR n.title = c.title)
      )
    )
  ORDER BY n.id, m.updated_at DESC NULLS LAST, m.id DESC
) src
WHERE n.id = src.id;

UPDATE assignments
SET description = replace(description, 'пример отката.', 'пример' || chr(160) || 'отката.')
WHERE description LIKE '%пример отката.';
