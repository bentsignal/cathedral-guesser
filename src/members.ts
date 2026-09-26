import {discord} from './discord';
import type {Env,Member} from './types';
export async function roster(env:Env):Promise<Member[]>{
  // Fetch current membership when the picker opens; do not retain a member database.
  const members:Member[]=[];let after='';
  for(let page=0;page<10;page++){
    const batch=await discord<Member[]>(env,`/guilds/${env.GUILD_ID}/members?limit=1000${after?'&after='+after:''}`);
    members.push(...batch.filter(m=>!m.user.bot));if(batch.length<1000)break;
    after=batch[batch.length-1].user.id;
  }
  return members.sort((a,b)=>memberName(a).localeCompare(memberName(b),'en',{sensitivity:'base'})||a.user.id.localeCompare(b.user.id));
}
export const memberName=(m:Member)=>m.nick||m.user.global_name||m.user.username;
export function memberControls(members:Member[],roundId:string,used:number,excluded:string[],page=0):unknown[]{
  const remaining=members.filter(m=>!excluded.includes(m.user.id));
  const pages=Math.max(1,Math.ceil(remaining.length/100));page=Math.max(0,Math.min(page,pages-1));
  const visible=remaining.slice(page*100,page*100+100),rows:unknown[]=[];
  for(let n=0;n<visible.length;n+=25){
    const group=visible.slice(n,n+25);
    const label=`${memberName(group[0])} – ${memberName(group[group.length-1])}`.slice(0,140);
    rows.push({type:1,components:[{type:3,custom_id:`guess:${roundId}:${used}:${n}`,placeholder:label,min_values:1,max_values:1,
      options:group.map(m=>({label:memberName(m).slice(0,100),description:('@'+m.user.username).slice(0,100),value:m.user.id}))}]});
  }
  if(pages>1)rows.push({type:1,components:[
    {type:2,style:2,label:'Previous',custom_id:`members:${roundId}:${page-1}`,disabled:page===0},
    {type:2,style:2,label:`Next (${page+1}/${pages})`,custom_id:`members:${roundId}:${page+1}`,disabled:page===pages-1},
  ]});
  return rows;
}
