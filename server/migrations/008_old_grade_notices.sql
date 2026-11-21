UPDATE notifications n
SET
  kind = 'grade',
  title = 'Баллы: ' || a.title,
  body = CASE
    WHEN trunc(s.score) = 5 THEN '10 из 10'
    WHEN trunc(s.score) = 4 THEN '8 из 10'
    WHEN trunc(s.score) = 3 THEN '6 из 10'
    WHEN trunc(s.score) = 2 THEN '4 из 10'
    WHEN trunc(s.score) = 1 THEN '2 из 10'
    WHEN trunc(s.score) = 0 THEN '0 из 10'
    WHEN s.score = trunc(s.score) THEN trunc(s.score)::int::text || ' из 10'
    ELSE replace(to_char(s.score, 'FM999990.0'), '.', ',') || ' из 10'
  END
FROM submissions s
JOIN assignments a ON a.id = s.assignment_id
WHERE n.body = 'Баллы выставлены'
  AND n.user_id = s.student_id
  AND s.score IS NOT NULL
  AND (n.title = a.title OR n.title = 'Баллы: ' || a.title);
