-- Колонки журнала. Одна дата может иметь несколько работ.
CREATE TABLE IF NOT EXISTS journal_columns (
  id               serial PRIMARY KEY,
  group_name       text NOT NULL,
  discipline       text NOT NULL,
  lesson_date      date NOT NULL,
  schedule_item_id integer NULL REFERENCES schedule_items(id) ON DELETE SET NULL,
  work_type        text NOT NULL CHECK (work_type IN
                   ('current','seminar','lab','control','test','colloquium','homework','essay','project','case','defense','credit')),
  title            text NOT NULL,
  max_score        integer NOT NULL DEFAULT 5 CHECK (max_score BETWEEN 1 AND 100),
  weight           numeric(3,1) NOT NULL DEFAULT 1 CHECK (weight > 0 AND weight <= 5),
  position         integer NOT NULL DEFAULT 0,
  created_by       integer NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS journal_columns_gdd ON journal_columns (group_name, discipline, lesson_date);
CREATE UNIQUE INDEX IF NOT EXISTS journal_columns_uniq
  ON journal_columns (group_name, discipline, lesson_date, work_type, title);

ALTER TABLE marks ADD COLUMN IF NOT EXISTS column_id  integer NULL REFERENCES journal_columns(id) ON DELETE SET NULL;
ALTER TABLE marks ADD COLUMN IF NOT EXISTS comment    text NULL;
ALTER TABLE marks ADD COLUMN IF NOT EXISTS teacher_id integer NULL;
ALTER TABLE marks ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS marks_student_column ON marks (student_id, column_id) WHERE column_id IS NOT NULL;

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS status  text NULL CHECK (status IN ('present','absent','sick','late','excused'));
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS comment text NULL;
UPDATE attendance SET status = CASE WHEN present THEN 'present' ELSE 'absent' END WHERE status IS NULL;

CREATE TABLE IF NOT EXISTS lesson_topics (
  id serial PRIMARY KEY,
  group_name text NOT NULL, discipline text NOT NULL, lesson_date date NOT NULL,
  schedule_item_id integer NULL REFERENCES schedule_items(id) ON DELETE SET NULL,
  topic text NOT NULL, teacher_id integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_name, discipline, lesson_date)
);

INSERT INTO journal_columns (group_name, discipline, lesson_date, schedule_item_id, work_type, title, max_score, weight, created_by)
SELECT DISTINCT u.group_name, d.name, m.awarded_on,
  (SELECT s.id FROM schedule_items s WHERE s.group_name=u.group_name AND s.discipline=d.name AND s.date=m.awarded_on
     ORDER BY s.pair_number LIMIT 1),
  CASE WHEN m.kind='credit' THEN 'credit'
       WHEN m.label ~* '^контрольн|^самостоят' THEN 'control'
       WHEN m.label ~* '^тест'      THEN 'test'
       WHEN m.label ~* '^лаборат'   THEN 'lab'
       WHEN m.label ~* '^коллокв'   THEN 'colloquium'
       WHEN m.label ~* '^эссе'      THEN 'essay'
       WHEN m.label ~* '^проект'    THEN 'project'
       WHEN m.label ~* '^кейс'      THEN 'case'
       WHEN m.label ~* '^защит'     THEN 'defense'
       WHEN m.label ~* '^задач|^дз|^домашн' THEN 'homework'
       WHEN m.label ~* '^семинар'   THEN 'seminar'
       ELSE 'current' END,
  m.label, 5,
  CASE WHEN m.label ~* '^контрольн|^самостоят|^коллокв' THEN 2
       WHEN m.label ~* '^тест|^лаборат|^проект' THEN 1.5
       ELSE 1 END,
  COALESCE((SELECT t.teacher_id FROM teaching_load t WHERE t.group_name=u.group_name AND t.discipline=d.name LIMIT 1), 0)
FROM marks m JOIN disciplines d ON d.id=m.discipline_id JOIN users u ON u.id=m.student_id
WHERE m.column_id IS NULL AND m.awarded_on IS NOT NULL AND u.group_name IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE marks m SET column_id = c.id
FROM disciplines d, users u, journal_columns c
WHERE m.column_id IS NULL AND d.id=m.discipline_id AND u.id=m.student_id
  AND c.group_name=u.group_name AND c.discipline=d.name AND c.lesson_date=m.awarded_on AND c.title=m.label;
