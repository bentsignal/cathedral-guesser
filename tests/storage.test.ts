import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createRound, maintenance, publishResults, revealOldRounds, syncHistory } from '../src/storage';
import { gameDay } from '../src/game';
import type { Env, Message } from '../src/types';

let db: DatabaseSync;
let env: Env;
function statement(sql: string, args: any[] = []): any {
  return {
    bind: (...values:any[])=>statement(sql,values),
    first: async (column?:string)=> { const row=db.prepare(sql).get(...args) as any; return column ? row?.[column]??null : row??null; },
    all: async()=>({results:db.prepare(sql).all(...args),success:true}),
    run: async()=>({success:true,meta:db.prepare(sql).run(...args)}),
  };
}
const msg=(id:string,content='a historical quote'):Message=>({id,content,type:0,timestamp:'2016-01-01T00:00:00Z',author:{id:'author',username:'author'}});
beforeEach(()=>{
  db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0002_recaps.sql',import.meta.url),'utf8'));
  env={DB:{prepare:statement,batch:async(stmts:any[])=>{db.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}} as any,
    GUILD_ID:'guild',SOURCE_CHANNEL_ID:'source',GAME_CHANNEL_ID:'game',DISCORD_APPLICATION_ID:'bot',DISCORD_TOKEN:'test-token',TIME_ZONE:'America/New_York',DISCORD_PUBLIC_KEY:''};
});
afterEach(()=>{db.close();vi.restoreAllMocks();vi.unstubAllGlobals();});
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
describe('resumable history and daily lifecycle',()=>{
  it('imports all history pages before selecting a daily puzzle',async()=>{
    const page=Array.from({length:100},(_,i)=>msg(String(1000-i)));
    const fetcher=vi.fn().mockResolvedValueOnce(response(page)).mockResolvedValueOnce(response([msg('800')]));
    vi.stubGlobal('fetch',fetcher);
    await syncHistory(env);
    expect(await createRound(env)).toBeNull();
    await syncHistory(env);
    expect(fetcher.mock.calls[1][0]).toContain('&before=901');
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toMatchObject({n:101});
    expect(db.prepare("SELECT value FROM state WHERE key='history_complete'").get()).toMatchObject({value:'1'});
  });
  it('leaves the cursor unchanged when Discord rate-limits a page',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({retry_after:10},429)));
    await expect(syncHistory(env)).rejects.toMatchObject({status:429});
    expect(db.prepare('SELECT COUNT(*) AS n FROM state').get()).toMatchObject({n:0});
  });
  it('imports new messages incrementally after the initial archive',async()=>{
    db.exec("INSERT INTO state VALUES ('history_complete','1'),('latest_id','100')");
    const fetcher=vi.fn().mockResolvedValue(response([msg('103'),msg('102'),msg('101')]));vi.stubGlobal('fetch',fetcher);
    await syncHistory(env);
    expect(fetcher.mock.calls[0][0]).toContain('&after=100');
    expect(db.prepare("SELECT value FROM state WHERE key='latest_id'").get()).toMatchObject({value:'103'});
  });
  it('revalidates author membership and skips deleted messages',async()=>{
    db.exec("INSERT INTO state VALUES ('history_complete','1'); INSERT INTO messages(id,author_id,content,timestamp) VALUES ('1','departed','quote','2016');");
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({},404)));
    expect(await createRound(env)).toBeNull();
    expect(db.prepare("SELECT eligible FROM messages WHERE id='1'").get()).toMatchObject({eligible:0});
  });
  it('closes the old puzzle, removes controls and reveals the original author',async()=>{
    db.exec("INSERT INTO rounds(id,day,source_id,author_id,content,status,discord_id) VALUES ('old','2000-01-01','source-message','author','quote','open','public-post');");
    const fetcher=vi.fn().mockResolvedValue(response({}));vi.stubGlobal('fetch',fetcher);
    await revealOldRounds(env);
    expect(db.prepare("SELECT status,revealed FROM rounds WHERE id='old'").get()).toMatchObject({status:'closed',revealed:1});
    const payload=JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload.components).toEqual([]);
    expect(payload.embeds[0].description).toContain('<@author>');
    expect(db.prepare('SELECT COUNT(*) AS n FROM recaps').get()).toMatchObject({n:1});
    await revealOldRounds(env);
    expect(db.prepare('SELECT COUNT(*) AS n FROM recaps').get()).toMatchObject({n:1});
  });
  it('retries a saved result after a failed Discord send without changing the guess',async()=>{
    db.exec("INSERT INTO rounds(id,day,source_id,author_id,content,status) VALUES ('round','2026-09-25','source-message','author','quote','open'); INSERT INTO guesses(round_id,user_id,guessed_id,correct,interaction_id) VALUES ('round','player','author',1,'interaction');");
    let fail=true;
    const fetcher=vi.fn(async(_url:any,init:any)=>init.method==='GET'?response([]):fail?response({},500):response({id:'result-post'}));vi.stubGlobal('fetch',fetcher);
    await expect(publishResults(env)).rejects.toMatchObject({status:500});
    expect(db.prepare('SELECT correct,published_id FROM guesses').get()).toMatchObject({correct:1,published_id:null});
    fail=false;await publishResults(env);
    expect(db.prepare('SELECT published_id FROM guesses').get()).toMatchObject({published_id:'result-post'});
    await publishResults(env);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('recovers a result already posted before the database acknowledgment failed',async()=>{
    db.exec("INSERT INTO rounds(id,day,source_id,author_id,content,status) VALUES ('round','2026-09-25','s','author','quote','open'); INSERT INTO guesses(round_id,user_id,guessed_id,correct,interaction_id) VALUES ('round','player','author',1,'interaction');");
    const fetcher=vi.fn().mockResolvedValue(response([{id:'existing',author:{id:'bot'},embeds:[{footer:{text:'Result interaction'}}]}]));vi.stubGlobal('fetch',fetcher);
    await publishResults(env);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT published_id FROM guesses').get()).toMatchObject({published_id:'existing'});
  });
});
