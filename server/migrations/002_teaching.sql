-- Добавляет преподавателя и задания. Существующие строки не удаляет.

DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'users' AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE '%role%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('student', 'staff', 'teacher'));

CREATE TABLE IF NOT EXISTS teaching_load (
  id serial PRIMARY KEY,
  teacher_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_name text NOT NULL,
  discipline text NOT NULL,
  UNIQUE (teacher_id, group_name, discipline)
);

CREATE TABLE IF NOT EXISTS assignments (
  id serial PRIMARY KEY,
  group_name text NOT NULL,
  discipline text NOT NULL,
  teacher_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL,
  kind text NOT NULL,
  max_score integer NOT NULL DEFAULT 5,
  issued_on date NOT NULL,
  deadline date NOT NULL,
  schedule_item_id integer,
  attachments jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_name, title)
);

CREATE TABLE IF NOT EXISTS submissions (
  id serial PRIMARY KEY,
  assignment_id integer NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL,
  body text,
  links jsonb NOT NULL DEFAULT '[]',
  teacher_comment text,
  score integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id serial PRIMARY KEY,
  teacher_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_name text NOT NULL,
  discipline text NOT NULL,
  lesson_date date NOT NULL,
  present boolean NOT NULL,
  UNIQUE (student_id, discipline, lesson_date)
);

CREATE TABLE IF NOT EXISTS group_announcements (
  id serial PRIMARY KEY,
  teacher_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_name text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assignments_group_idx ON assignments (group_name);
CREATE INDEX IF NOT EXISTS submissions_student_idx ON submissions (student_id);
CREATE INDEX IF NOT EXISTS submissions_status_idx ON submissions (status);
