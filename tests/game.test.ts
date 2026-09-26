import { describe, it, expect } from 'vitest';
import { gameDay, eligibleMessage, displayQuote, roundPayload, recapPages } from '../src/game';
import type { Message, Round } from '../src/types';

const message = {id:'123',author:{id:'456',username:'test'},content:'hello world',type:0,timestamp:'2026-09-25T10:00:00Z'} satisfies Message;
const round = {id:'2026-09-25',day:'2026-09-25',practice:0,source_id:'123',author_id:'456',content:'hello world',status:'open',discord_id:'789',revealed:0} satisfies Round;
describe('daily game rules',()=>{
  it('resets at Eastern midnight in summer and winter',()=>{
    expect(gameDay(new Date('2026-09-26T03:59:59Z'),'America/New_York')).toBe('2026-09-25');
    expect(gameDay(new Date('2026-09-26T04:00:00Z'),'America/New_York')).toBe('2026-09-26');
    expect(gameDay(new Date('2026-01-26T04:59:59Z'),'America/New_York')).toBe('2026-01-25');
    expect(gameDay(new Date('2026-01-26T05:00:00Z'),'America/New_York')).toBe('2026-01-26');
  });
  it('handles the spring-forward and fall-back transitions',()=>{
    expect(gameDay(new Date('2026-03-08T07:00:00Z'),'America/New_York')).toBe('2026-03-08');
    expect(gameDay(new Date('2026-11-01T06:00:00Z'),'America/New_York')).toBe('2026-11-01');
  });
  it('accepts text messages and replies, excluding bots, webhooks, empty and system messages',()=>{
    expect(eligibleMessage(message)).toBe(true);
    expect(eligibleMessage({...message,type:19})).toBe(true);
    for(const m of [{...message,content:'  '},{...message,type:7},{...message,webhook_id:'x'},{...message,author:{...message.author,bot:true}},{...message,content:'x'.repeat(3501)}]) expect(eligibleMessage(m)).toBe(false);
  });
  it('hides identifying mentions and clickable links',()=>{
    expect(displayQuote('<@123> <@!456> <@&789> <#999> https://example.com **bold**')).toBe('@someone @someone @role #channel \\[link\\] \\*\\*bold\\*\\*');
  });
  it('keeps the author out of the public puzzle and reveals only on close',()=>{
    const open=JSON.stringify(roundPayload(round));
    expect(open).not.toContain('456');
    expect(open).not.toContain('/123');
    expect(open).toContain('play:2026-09-25');
    const closed=roundPayload(round,true,5,2,'guild','channel');
    expect(closed.components).toEqual([]);
    expect(closed.embeds[0].description).toContain('<@456>');
    expect(closed.embeds[0].description).toContain('2 of 5');
  });
});


describe('nightly recaps',()=>{
  it('lists every correct player before every incorrect player',()=>{
    const recap=recapPages('2026-09-25',[{user_id:'wrong1',correct:0},{user_id:'right1',correct:1},{user_id:'wrong2',correct:0},{user_id:'right2',correct:1}]).join('\n');
    expect(recap.indexOf('<@right1>')).toBeLessThan(recap.indexOf('<@wrong1>'));
    expect(recap.indexOf('<@right2>')).toBeLessThan(recap.indexOf('<@wrong1>'));
    expect(recap).toContain('4 played · 2 correct · 2 incorrect');
    for(const id of ['wrong1','right1','wrong2','right2']) expect(recap.split(`<@${id}>`)).toHaveLength(2);
  });
  it('paginates a large server without dropping any players or exceeding embed limits',()=>{
    const players=Array.from({length:500},(_,i)=>({user_id:String(100000000000000000n+BigInt(i)),correct:i%2}));
    const pages=recapPages('2026-09-25',players);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every(p=>p.length<=3500)).toBe(true);
    for(const player of players) expect(pages.join('\n').split(`<@${player.user_id}>`)).toHaveLength(2);
  });
  it('handles days with no players',()=>{
    expect(recapPages('2026-09-25',[])[0]).toContain('0 played · 0 correct · 0 incorrect');
  });
});
