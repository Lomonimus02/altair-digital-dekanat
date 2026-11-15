CREATE TABLE IF NOT EXISTS clarifications (
  id text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tool text NOT NULL,
  args jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clarifications_user_idx ON clarifications (user_id);
