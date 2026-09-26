import type {Env,Member} from './types';
import {roster} from './members';
import {search} from './sampling';
export const AUTHOR_THRESHOLD=100;
interface Count {user_id:string;message_count:number;checked_at:number}
export async function eligibleAuthors(env:Env,budget=6):Promise<{members:Member[];ready:boolean;remaining:number}>{
  const members=await roster(env);
  const stored=await env.DB.prepare('SELECT user_id,message_count,checked_at FROM author_counts WHERE source_channel_id=?').bind(env.SOURCE_CHANNEL_ID).all<Count>();
  const counts=new Map(stored.results.map(row=>[row.user_id,row]));
  const now=Date.now();
  // Unknown members first; cached qualifiers stay usable while their count refreshes.
  const pending=members.filter(m=>!counts.has(m.user.id)||now-counts.get(m.user.id)!.checked_at>(counts.get(m.user.id)!.message_count>AUTHOR_THRESHOLD?7:1)*86400000)
    .sort((a,b)=>(counts.get(a.user.id)?.checked_at||0)-(counts.get(b.user.id)?.checked_at||0));
  for(const member of pending.slice(0,budget)){
    const result=await search(env,{author_id:member.user.id,limit:'1'});if(!result)break;
    if(!Number.isFinite(result.total_results))break;
    const row={user_id:member.user.id,message_count:result.total_results,checked_at:now};
    await env.DB.prepare(`INSERT INTO author_counts(source_channel_id,user_id,message_count,checked_at) VALUES (?,?,?,?)
      ON CONFLICT(source_channel_id,user_id) DO UPDATE SET message_count=excluded.message_count,checked_at=excluded.checked_at`)
      .bind(env.SOURCE_CHANNEL_ID,row.user_id,row.message_count,row.checked_at).run();
    counts.set(row.user_id,row);
  }
  const remaining=members.filter(m=>!counts.has(m.user.id)).length;
  return {ready:remaining===0,remaining,members:members.filter(m=>(counts.get(m.user.id)?.message_count||0)>AUTHOR_THRESHOLD)};
}
