-- Operational throttle; keyed by a digest, not by an email or IP in plaintext.
CREATE TABLE teluria.auth_attempts (
  key_hash text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts >= 0),
  window_started_at timestamptz NOT NULL
);
CREATE INDEX auth_attempts_window_idx ON teluria.auth_attempts(window_started_at);
