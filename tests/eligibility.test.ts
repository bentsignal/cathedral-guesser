import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {eligibleAuthors} from '../src/eligibility';
import * as members from '../src/members';
import * as sampling from '../src/sampling';
import type {Env} from '../src/types';
let db:DatabaseSync,env:Env;
function statement(sql:string,args:unknown[]=[]):any{return {bind:(...values:unknown[])=>statement(sql,values),first:async(column?:string)=>{const row=db.prepare(sql).get(...args as any[]) as any;return column?row?.[column]??null:row??null;},all:async()=>({results:db.prepare(sql).all(...args as any[])}),run:async()=>db.prepare(sql).run(...args as any[]) };}
beforeEach(()=>{db=new DatabaseSync(':memory:');for(const name of ['0001_initial','0006_regular_authors'])db.exec(readFileSync(new URL(`../migrations/${name}.sql`,import.meta.url),'utf8'));env={SOURCE_CHANNEL_ID:'source',DB:{prepare:statement}} as unknown as Env;});
afterEach(()=>{vi.restoreAllMocks();db.close();});
describe('regular-author pool',()=>{
 it('excludes configured authors from the pool and count checks, scoped to the source',async()=>{
  vi.spyOn(members,'roster').mockResolvedValue(['a','b'].map(id=>({user:{id,username:id}})));
  db.prepare('INSERT INTO state(key,value) VALUES (?,?)').run('excluded_authors:source',JSON.stringify(['a']));
  const search=vi.spyOn(sampling,'search').mockResolvedValue({total_results:500,messages:[]});
  const pool=await eligibleAuthors(env);
  expect(pool.ready).toBe(true);expect(pool.members.map(m=>m.user.id)).toEqual(['b']);
  expect(search).toHaveBeenCalledTimes(1);expect(search.mock.calls[0][1].author_id).toBe('b');
  env.SOURCE_CHANNEL_ID='other';expect((await eligibleAuthors(env)).members).toHaveLength(2);
 });
 it('requires more than 100 source-channel messages and caches the result',async()=>{
  vi.spyOn(members,'roster').mockResolvedValue(['a','b','c'].map(id=>({user:{id,username:id}})));
  const search=vi.spyOn(sampling,'search').mockImplementation(async(_env,params)=>({total_results:{a:99,b:100,c:101}[params.author_id]!,messages:[]}));
  const first=await eligibleAuthors(env);expect(first.ready).toBe(true);expect(first.members.map(m=>m.user.id)).toEqual(['c']);
  expect(search.mock.calls.every(call=>call[1].author_id&&call[1].limit==='1')).toBe(true);
  await eligibleAuthors(env);expect(search).toHaveBeenCalledTimes(3);
 });
 it('pauses on rate limits without treating unchecked people as ineligible',async()=>{
  vi.spyOn(members,'roster').mockResolvedValue([{user:{id:'a',username:'a'}},{user:{id:'b',username:'b'}}]);
  const search=vi.spyOn(sampling,'search').mockResolvedValueOnce({total_results:200,messages:[]}).mockResolvedValueOnce(null);
  const result=await eligibleAuthors(env);expect(result).toMatchObject({ready:false,remaining:1});expect(result.members.map(m=>m.user.id)).toEqual(['a']);
  search.mockResolvedValue({total_results:250,messages:[]});expect((await eligibleAuthors(env)).ready).toBe(true);
 });
 it('ignores former members and counts cached for another source channel',async()=>{
  vi.spyOn(members,'roster').mockResolvedValue([{user:{id:'new',username:'new'}}]);
  db.prepare('INSERT INTO author_counts VALUES (?,?,?,?)').run('source','gone',10000,Date.now());
  db.prepare('INSERT INTO author_counts VALUES (?,?,?,?)').run('other','new',10000,Date.now());
  vi.spyOn(sampling,'search').mockResolvedValue({total_results:20,messages:[]});
  expect((await eligibleAuthors(env)).members).toEqual([]);
 });
 it('bounds refresh work and refreshes below-threshold counts after a day',async()=>{
  vi.spyOn(members,'roster').mockResolvedValue([{user:{id:'a',username:'a'}},{user:{id:'b',username:'b'}}]);
  db.prepare('INSERT INTO author_counts VALUES (?,?,?,?)').run('source','a',100,Date.now()-2*86400000);
  const search=vi.spyOn(sampling,'search').mockResolvedValue({total_results:101,messages:[]});
  await eligibleAuthors(env,1);expect(search).toHaveBeenCalledTimes(1);expect(search.mock.calls[0][1].author_id).toBe('b');
  expect((await eligibleAuthors(env,1)).members).toHaveLength(2);
 });
});
