import { digest } from "../domain/credentials.js";
import { fail } from "../../../errors.js";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function createLoginThrottle(pool) {
  const keyFor = (email) => digest(`login:${email}`);
  return {
    async check(email) {
      const result = await pool.query("SELECT attempts,window_started_at FROM teluria.auth_attempts WHERE key_hash=$1", [keyFor(email)]);
      const row = result.rows[0];
      if (row && row.attempts >= MAX_ATTEMPTS && Date.now() - new Date(row.window_started_at).getTime() < WINDOW_MS)
        fail(429, "Too many attempts. Try again in 10 minutes.");
    },
    async failure(email) {
      await pool.query(`
        INSERT INTO teluria.auth_attempts(key_hash,attempts,window_started_at) VALUES($1,1,now())
        ON CONFLICT(key_hash) DO UPDATE SET
          attempts=CASE WHEN teluria.auth_attempts.window_started_at < now()-interval '10 minutes' THEN 1 ELSE teluria.auth_attempts.attempts+1 END,
          window_started_at=CASE WHEN teluria.auth_attempts.window_started_at < now()-interval '10 minutes' THEN now() ELSE teluria.auth_attempts.window_started_at END
      `, [keyFor(email)]);
    },
    async clear(email) {
      await pool.query("DELETE FROM teluria.auth_attempts WHERE key_hash=$1", [keyFor(email)]);
    },
  };
}
