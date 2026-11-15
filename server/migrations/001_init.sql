CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  login text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('student', 'staff')),
  full_name text NOT NULL,
  institute text,
  direction text,
  course integer,
  group_name text,
  record_book text,
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  show_cancelled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS schedule_items (
  id serial PRIMARY KEY,
  group_name text NOT NULL,
  date date NOT NULL,
  starts_at text NOT NULL,
  ends_at text NOT NULL,
  discipline text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('lecture', 'seminar', 'lab', 'practice')),
  room text,
  teacher text,
  change_type text NOT NULL DEFAULT 'none' CHECK (change_type IN ('none', 'cancelled', 'moved', 'room')),
  change_note text,
  pair_number integer NOT NULL
);
CREATE INDEX IF NOT EXISTS schedule_group_date_idx ON schedule_items(group_name, date);

CREATE TABLE IF NOT EXISTS schedule_flags (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schedule_item_id integer NOT NULL REFERENCES schedule_items(id) ON DELETE CASCADE,
  flagged boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, schedule_item_id)
);

CREATE TABLE IF NOT EXISTS disciplines (
  id serial PRIMARY KEY,
  student_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  control_form text NOT NULL CHECK (control_form IN ('exam', 'credit')),
  session_date date,
  obligatory_total integer NOT NULL DEFAULT 0,
  obligatory_done integer NOT NULL DEFAULT 0,
  semester text NOT NULL
);
CREATE INDEX IF NOT EXISTS disciplines_student_idx ON disciplines(student_id);

CREATE TABLE IF NOT EXISTS marks (
  id serial PRIMARY KEY,
  discipline_id integer NOT NULL REFERENCES disciplines(id) ON DELETE CASCADE,
  student_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL,
  value integer CHECK (value IS NULL OR value BETWEEN 0 AND 5),
  kind text NOT NULL CHECK (kind IN ('current', 'exam', 'credit')),
  awarded_on date
);
CREATE INDEX IF NOT EXISTS marks_student_idx ON marks(student_id);

CREATE TABLE IF NOT EXISTS requests (
  id serial PRIMARY KEY,
  student_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  purpose text,
  body text,
  status text NOT NULL CHECK (status IN ('submitted', 'in_progress', 'ready', 'issued', 'rejected', 'withdrawn')),
  rejection_reason text,
  result_note text,
  verify_code text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS requests_student_idx ON requests(student_id);

CREATE TABLE IF NOT EXISTS request_events (
  id serial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status text NOT NULL,
  comment text,
  actor_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  href text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS announcements (
  id serial PRIMARY KEY,
  author_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reminders (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  due_at timestamptz NOT NULL,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('agent', 'ui', 'staff')),
  action text NOT NULL,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL,
  reversible boolean NOT NULL DEFAULT false,
  undo jsonb,
  undone_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_user_idx ON audit_log(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pending_actions (
  id text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action text NOT NULL,
  args jsonb NOT NULL,
  preview jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS regulations (
  id serial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  body text NOT NULL
);
