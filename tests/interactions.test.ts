import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { INSERT_GUESS } from '../src/index';
import { discord, verifySignature } from '../src/discord';
import { gameDay } from '../src/game';
import type { Env } from '../src/types';

let db: DatabaseSync;
beforeEach(()=>{db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0002_recaps.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0003_media.sql',import.meta.url),'utf8'));});
afterEach(()=>{db.close();vi.restoreAllMocks();});
const seed = (id='round',day='2026-09-25',status='open',practice=0) => db.prepare('INSERT INTO rounds(id,day,source_id,author_id,content,status,practice) VALUES (?,?,?,?,?,?,?)').run(id,day,'source','author','a quote',status,practice);
const guess=(user:string,author:string,interaction:string,day='2026-09-25',round='round')=>db.prepare(INSERT_GUESS).get(user,author,author,interaction,round,day);
describe('atomic one-guess persistence',()=>{
  it('allows only the first guess, even when the second would be correct',()=>{
    seed();expect(guess('player','wrong','i1')).toMatchObject({correct:0});
    expect(guess('player','author','i2')).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM guesses').get()).toMatchObject({n:1});
  });
  it('does not block another player',()=>{
    seed();guess('one','wrong','i1');expect(guess('two','author','i2')).toMatchObject({correct:1});
  });
  it('rejects expired, pending, closed, and nonexistent rounds',()=>{
    seed();expect(guess('player','author','i1','2026-09-26')).toBeUndefined();
    seed('pending','2026-09-25','pending',1);expect(guess('player','author','i2','2026-09-25','pending')).toBeUndefined();
    seed('closed','2026-09-25','closed',1);expect(guess('player','author','i3','2026-09-25','closed')).toBeUndefined();
    expect(guess('player','author','i4','2026-09-25','missing')).toBeUndefined();
  });
  it('deduplicates interaction delivery',()=>{
    seed();guess('player','author','i1');expect(guess('player','author','i1')).toBeUndefined();
  });
  it('keeps practice separate from the daily one-guess limit',()=>{
    seed();seed('practice','2026-09-25','open',1);
    expect(guess('player','author','i1')).toBeDefined();
    expect(guess('player','author','i2','2026-09-25','practice')).toBeDefined();
  });
  it('enforces one daily puzzle in the database',()=>{
    seed();expect(()=>seed('duplicate')).toThrow();
  });
});

async function signing() {
  const keys=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
  const publicKey=Buffer.from(await crypto.subtle.exportKey('raw',keys.publicKey)).toString('hex');
  return {publicKey,async request(body:string,timestamp=String(Math.floor(Date.now()/1000))) {
    const signature=Buffer.from(await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(timestamp+body))).toString('hex');
    return new Request('https://test/interactions',{method:'POST',body,headers:{'x-signature-ed25519':signature,'x-signature-timestamp':timestamp}});
  }};
}
describe('Discord endpoint security',()=>{
  it('accepts a valid Ed25519 signature and rejects changed content and stale requests',async()=>{
    const s=await signing();const r=await s.request('{"type":1}');
    expect(await verifySignature(r,'{"type":1}',s.publicKey)).toBe(true);
    expect(await verifySignature(r,'{"type":2}',s.publicKey)).toBe(false);
    expect(await verifySignature(await s.request('{}','1'),'{}',s.publicKey)).toBe(false);
  });
  it('rejects malformed signatures without throwing',async()=>{
    expect(await verifySignature(new Request('https://test'),'{}','bad')).toBe(false);
  });
  it('responds to signed Discord ping but refuses unsigned traffic',async()=>{
    const s=await signing();const env={DISCORD_PUBLIC_KEY:s.publicKey} as Env;
    const ctx={waitUntil:vi.fn()} as unknown as ExecutionContext;
    const ping=await worker.fetch(await s.request('{"type":1}'),env,ctx);
    expect(await ping.json()).toEqual({type:1});
    expect((await worker.fetch(new Request('https://test/interactions',{method:'POST',body:'{}'}),env,ctx)).status).toBe(401);
  });
  it('refuses interactions from another server without scheduling work',async()=>{
    const s=await signing();const ctx={waitUntil:vi.fn()} as unknown as ExecutionContext;
    const response=await worker.fetch(await s.request(JSON.stringify({type:2,application_id:'app',guild_id:'other',member:{user:{id:'player'}}})),{DISCORD_PUBLIC_KEY:s.publicKey,DISCORD_APPLICATION_ID:'app',GUILD_ID:'configured'} as Env,ctx);
    expect(await response.json()).toMatchObject({type:4,data:{flags:64}});
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });
});

describe('non-destructive guess completion',()=>{
  it('replaces the selector without deleting any message',async()=>{
    const storage=await import('../src/storage');
    vi.spyOn(storage,'publishResults').mockResolvedValue();
    const requests:{url:string;method:string}[]=[];
    vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
      requests.push({url:String(input),method:init?.method||'GET'});
      if(init?.method==='DELETE')return new Response(null,{status:204});
      return Response.json({user:{id:'123456789012345678',bot:false}});
    });
    const first=vi.fn().mockResolvedValue({correct:1});
    const s=await signing();
    const env={DISCORD_PUBLIC_KEY:s.publicKey,DISCORD_APPLICATION_ID:'app',GUILD_ID:'guild',TIME_ZONE:'America/New_York',DB:{prepare:()=>({bind:()=>({first})})}} as unknown as Env;
    let pending:Promise<unknown>|undefined;
    const ctx={waitUntil:(p:Promise<unknown>)=>{pending=p;}} as ExecutionContext;
    const interaction={type:3,id:'interaction',token:'test-token',application_id:'app',guild_id:'guild',member:{user:{id:'player'}},data:{custom_id:'guess:round',values:['123456789012345678']}};
    const response=await worker.fetch(await s.request(JSON.stringify(interaction)),env,ctx);
    expect(await response.json()).toEqual({type:6});
    await pending;
    expect(first).toHaveBeenCalledOnce();
    expect(requests).toContainEqual({url:'https://discord.com/api/v10/webhooks/app/test-token/messages/@original',method:'PATCH'});
    expect(requests.some(r=>r.method==='DELETE')).toBe(false);
    expect(storage.publishResults).toHaveBeenCalledOnce();
  });
});

 it('blocks Discord deletion before sending a request',async()=>{
   const fetcher=vi.spyOn(globalThis,'fetch');
   await expect(discord({} as Env,'/channels/1/messages/2','DELETE')).rejects.toThrow('prohibited');
   await expect(discord({} as Env,'/channels/1/messages/bulk-delete','POST',{messages:['1','2']})).rejects.toThrow('prohibited');
   expect(fetcher).not.toHaveBeenCalled();
 });
