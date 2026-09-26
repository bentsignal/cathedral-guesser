import type {Env,Message} from './types';
import {DiscordError} from './discord';

const EPOCH=1420070400000;
export const snowflake=(time:number)=>((BigInt(Math.max(0,Math.floor(time)-EPOCH)))<<22n).toString();
interface Search {total_results:number;messages:Message[][];code?:number;retry_after?:number}
async function getState(env:Env,key:string){return env.DB.prepare('SELECT value FROM state WHERE key=?').bind(key).first<string>('value');}
async function putState(env:Env,key:string,value:string){await env.DB.prepare('INSERT INTO state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value).run();}
export async function search(env:Env,params:Record<string,string>):Promise<Search|null>{
  if(Number(await getState(env,'search_resume_at')||0)>Date.now())return null;
  const query=new URLSearchParams({channel_id:env.SOURCE_CHANNEL_ID,author_type:'user',sort_by:'timestamp',...params});
  const response=await fetch(`https://discord.com/api/v10/guilds/${env.GUILD_ID}/messages/search?${query}`,{headers:{Authorization:`Bot ${env.DISCORD_TOKEN}`},signal:AbortSignal.timeout(10000)});
  if(response.status===429 || response.status===202){
    const data=await response.json() as Search;
    const delay=Math.max(5,Number(data.retry_after)||Number(response.headers.get('retry-after'))||30);
    await putState(env,'search_resume_at',String(Date.now()+delay*1000));return null;
  }
  if(!response.ok)throw new DiscordError(response.status);
  if(response.headers.get('x-ratelimit-remaining')==='0'){
    const delay=Math.max(1,Number(response.headers.get('x-ratelimit-reset-after'))||5);
    await putState(env,'search_resume_at',String(Date.now()+delay*1000));
  }
  return response.json();
}
// A random month gives quiet older years a chance alongside busy recent years.
// Only counts and the oldest timestamp are retained; message pages stay in memory.
export async function sampleCandidates(env:Env):Promise<Message[]> {
  let first=Number(await getState(env,'source_first_ms')||0);
  if(!first){
    const oldest=await search(env,{sort_order:'asc',limit:'1'});
    const message=oldest?.messages?.flat()[0];if(!message)return [];
    first=new Date(message.timestamp).getTime();if(!Number.isFinite(first))return [];
    await putState(env,'source_first_ms',String(first));
  }
  const start=new Date(first),now=new Date();
  const startMonth=start.getUTCFullYear()*12+start.getUTCMonth();
  const endMonth=now.getUTCFullYear()*12+now.getUTCMonth();
  let requests=0;
  for(let attempt=0;attempt<3;attempt++){
    const month=startMonth+Math.floor(Math.random()*(endMonth-startMonth+1));
    let lo=Date.UTC(Math.floor(month/12),month%12,1),hi=Math.min(Date.UTC(Math.floor(month/12),month%12+1,1),Date.now()+1);
    for(let depth=0;depth<8;depth++){
      const bounds={min_id:snowflake(lo),max_id:snowflake(hi),sort_order:'asc'};
      if(++requests>8)return [];
      const count=await search(env,{...bounds,limit:'1'});if(!count)return [];
      if(!count.total_results)break;
      // Search only allows offsets through 9975. Narrow busy periods before jumping.
      if(count.total_results>9975){const mid=Math.floor((lo+hi)/2);if(mid<=lo)break;if(Math.random()<0.5)hi=mid;else lo=mid;continue;}
      const offset=Math.floor(Math.random()*count.total_results);
      const page=await search(env,{...bounds,offset:String(offset),limit:'25'});if(!page)return [];
      const messages=page.messages?.flat()||[];
      // Shuffle so validation does not consistently favor the start of a page.
      for(let i=messages.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[messages[i],messages[j]]=[messages[j],messages[i]];}
      if(messages.length)return messages;
      break;
    }
  }
  return [];
}
