CREATE TABLE IF NOT EXISTS title_kakko_kari_room_state (
  state_key text PRIMARY KEY,
  revision bigint NOT NULL CHECK (revision >= 0),
  writer_id uuid NOT NULL,
  commit_id uuid NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON title_kakko_kari_room_state FROM PUBLIC;
