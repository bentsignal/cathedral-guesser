import type {Env} from './types';
// Expected attempt count prevents stale/double-clicked selectors spending another try.
export const INSERT_ATTEMPT=`INSERT INTO attempts(round_id,user_id,guessed_id,attempt,correct,interaction_id)
  SELECT r.id,?,?,?+1,CASE WHEN r.author_id=? THEN 1 ELSE 0 END,? FROM rounds r
  WHERE r.id=? AND r.day=? AND r.status='open'
  AND ? < r.guess_limit
  AND (SELECT COUNT(*) FROM attempts a WHERE a.round_id=r.id AND a.user_id=?)=?
  AND NOT EXISTS(SELECT 1 FROM guesses g WHERE g.round_id=r.id AND g.user_id=?)
  ON CONFLICT DO NOTHING RETURNING *`;
export async function finalizeUnfinished(env:Env,roundId:string){
  await env.DB.prepare(`INSERT OR IGNORE INTO guesses(round_id,user_id,guessed_id,correct,interaction_id,attempts_used)
    SELECT a.round_id,a.user_id,a.guessed_id,0,'expired:'||a.interaction_id,a.attempt FROM attempts a
    JOIN rounds r ON r.id=a.round_id
    WHERE r.id=? AND r.status='closed' AND a.attempt=(SELECT MAX(b.attempt) FROM attempts b WHERE b.round_id=a.round_id AND b.user_id=a.user_id)`)
    .bind(roundId).run();
}
