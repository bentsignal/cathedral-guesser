import type { Env, Message, Round, Member, Guess } from './types';
import { discord, DiscordError, noMentions, nonce } from './discord';
import { eligibleMessage, gameDay, roundPayload, recapPages, resultPayload, recapPayload } from './game';

import { parseMedia, validateMedia } from './media';

export async function state(env: Env, key: string): Promise<string | null> {
  return env.DB.prepare('SELECT value FROM state WHERE key = ?').bind(key).first<string>('value');
}
export async function setState(env: Env, key: string, value: string) {
  await env.DB.prepare('INSERT INTO state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value).run();
}
export async function withLease<T>(env: Env, key: string, work: () => Promise<T>): Promise<T | undefined> {
  const holder = crypto.randomUUID();
  const acquired = await env.DB.prepare(`INSERT INTO leases(key,holder,expires) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET holder=excluded.holder, expires=excluded.expires WHERE leases.expires < ? RETURNING holder`)
    .bind(key, holder, Date.now()+120_000, Date.now()).first();
  if (!acquired) return;
  try { return await work(); }
  finally { await env.DB.prepare('DELETE FROM leases WHERE key=? AND holder=?').bind(key,holder).run(); }
}

async function archivePage(env: Env, messages: Message[]) {
  const rows = messages.filter(eligibleMessage).map(m => ({id:m.id,author:m.author.id,content:m.content,timestamp:m.timestamp,media:{attachments:m.attachments||[],previews:[]}}));
  if (!rows.length) return;
  await env.DB.prepare(`INSERT INTO messages(id,author_id,content,timestamp,media_json)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.author'),json_extract(value,'$.content'),json_extract(value,'$.timestamp'),json_extract(value,'$.media') FROM json_each(?)
    WHERE 1 ON CONFLICT(id) DO UPDATE SET content=excluded.content, author_id=excluded.author_id,media_json=excluded.media_json`)
    .bind(JSON.stringify(rows)).run();
}

export async function syncHistory(env: Env) {
  const complete = await state(env,'history_complete');
  const before = await state(env,'history_before');
  const latest = await state(env,'latest_id');
  if (!complete) {
    const page = await discord<Message[]>(env,`/channels/${env.SOURCE_CHANNEL_ID}/messages?limit=100${before ? `&before=${before}` : ''}`);
    await archivePage(env,page);
    if (!latest && page.length) await setState(env,'latest_id',page[0].id);
    if (page.length) await setState(env,'history_before',page[page.length-1].id);
    if (page.length<100) await setState(env,'history_complete','1');
  } else {
    // Discord returns the closest messages after the cursor, descending. Advancing to
    // the largest ID therefore catches up in pages without skipping busy periods.
    const page = await discord<Message[]>(env,`/channels/${env.SOURCE_CHANNEL_ID}/messages?limit=100${latest ? `&after=${latest}` : ''}`);
    await archivePage(env,page);
    if (page.length) await setState(env,'latest_id',page.reduce((max,m) => BigInt(m.id)>BigInt(max)?m.id:max,page[0].id));
  }
}
export async function currentMember(env: Env, userId: string): Promise<Member | null> {
  try {
    const member = await discord<Member>(env,`/guilds/${env.GUILD_ID}/members/${userId}`);
    return member.user.bot ? null : member;
  } catch (error) {
    if (error instanceof DiscordError && error.status===404) return null;
    throw error;
  }
}

export async function createRound(env: Env, id?: string, sourceId?: string): Promise<Round | null> {
  const day = gameDay(new Date(),env.TIME_ZONE);
  const roundId = id || day;
  const existing = await env.DB.prepare('SELECT * FROM rounds WHERE id=?').bind(roundId).first<Round>();
  if (existing) return existing;
  // Wait for the entire archive before sampling: every eligible historical message
  // deserves the same chance, rather than favoring the most recent imported page.
  if (!sourceId && !(await state(env,'history_complete'))) return null;
  for (let attempt=0;attempt<3;attempt++) {
    const candidate = sourceId && id ? await discord<Message>(env,`/channels/${env.SOURCE_CHANNEL_ID}/messages/${sourceId}`).then(m=>({id:m.id,author_id:m.author.id,content:m.content})) : await env.DB.prepare(`SELECT * FROM messages WHERE eligible=1 AND unavailable_until <= ${Date.now()}
      ${id ? 'ORDER BY random()' : 'ORDER BY CASE WHEN used_at IS NULL THEN 0 ELSE 1 END, CASE WHEN used_at IS NOT NULL THEN used_at END, random()'} LIMIT 1`)
      .first<{id:string;author_id:string;content:string}>();
    if (!candidate) return null;
    if (!(await currentMember(env,candidate.author_id))) {
      await env.DB.prepare('UPDATE messages SET eligible=0 WHERE author_id=?').bind(candidate.author_id).run();
      continue;
    }
    let live: Message;
    try { live = await discord<Message>(env,`/channels/${env.SOURCE_CHANNEL_ID}/messages/${candidate.id}`); }
    catch (error) {
      if (error instanceof DiscordError && error.status===404) {
        await env.DB.prepare('UPDATE messages SET eligible=0 WHERE id=?').bind(candidate.id).run();
        continue;
      }
      throw error;
    }
    if (!eligibleMessage(live)) {
      await env.DB.prepare('UPDATE messages SET eligible=0 WHERE id=?').bind(candidate.id).run();
      continue;
    }
    const media=await validateMedia(live);
    if(!media || roundPayload({id:roundId,day,practice:id?1:0,source_id:live.id,author_id:live.author.id,content:live.content,media_json:JSON.stringify(media),status:'pending',discord_id:null,revealed:0}).content.length>2000) {
      await env.DB.prepare('UPDATE messages SET unavailable_until=? WHERE id=?').bind(Date.now()+86400000,live.id).run();
      if(sourceId)return null;
      continue;
    }
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO rounds(id,day,practice,source_id,author_id,content,media_json) VALUES (?,?,?,?,?,?,?)')
        .bind(roundId,day,id?1:0,live.id,live.author.id,live.content,JSON.stringify(media)),
      ...(id ? [] : [env.DB.prepare('UPDATE messages SET used_at=? WHERE id=?').bind(new Date().toISOString(),live.id)]),
    ]);
    return env.DB.prepare('SELECT * FROM rounds WHERE id=?').bind(roundId).first<Round>();
  }
  return null;
}

async function existingPost(env: Env, marker: string): Promise<string | undefined> {
  const recent = await discord<Message[]>(env,`/channels/${env.GAME_CHANNEL_ID}/messages?limit=100`);
  return recent.find(m => m.author.id===env.DISCORD_APPLICATION_ID && (m.embeds?.some(e => e.footer?.text.startsWith(marker) || e.url?.endsWith(`#${encodeURIComponent(marker)}`)) || m.components?.some(row=>row.components?.some(c=>c.custom_id===marker))))?.id;
}
export async function publishRound(env: Env, round: Round) {
  if (round.discord_id) return;
  const found = await existingPost(env,`play:${round.id}`);
  const message = found ? {id:found} : await discord<{id:string}>(env,`/channels/${env.GAME_CHANNEL_ID}/messages`,'POST', {
    ...roundPayload(round), nonce:await nonce(`round:${round.id}`), enforce_nonce:true,
  });
  await env.DB.prepare("UPDATE rounds SET discord_id=?, status='open' WHERE id=? AND status='pending'").bind(message.id,round.id).run();
}
export async function revealOldRounds(env: Env) {
  const day = gameDay(new Date(),env.TIME_ZONE);
  await env.DB.prepare("UPDATE rounds SET status='closed' WHERE day < ? AND status!='closed'").bind(day).run();
  const old = await env.DB.prepare("SELECT * FROM rounds WHERE status='closed' AND revealed=0 LIMIT 1").all<Round>();
  for (const round of old.results) {
    if (round.discord_id) {
      const counts = await env.DB.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(correct),0) AS correct FROM guesses WHERE round_id=?').bind(round.id).first<{total:number;correct:number}>();
      try {
        await discord(env,`/channels/${env.GAME_CHANNEL_ID}/messages/${round.discord_id}`,'PATCH',roundPayload(round,true,counts!.total,counts!.correct,env.GUILD_ID,env.SOURCE_CHANNEL_ID));
      } catch (error) { if (!(error instanceof DiscordError && error.status===404)) throw error; }
    }
    {
      const players=await env.DB.prepare('SELECT user_id,correct FROM guesses WHERE round_id=? ORDER BY correct DESC,created_at,user_id').bind(round.id).all<{user_id:string;correct:number}>();
      const pages=recapPages(round.practice ? `${round.day} · Practice` : round.day,players.results).map((content,page)=>({content,page}));
      await env.DB.prepare(`INSERT OR IGNORE INTO recaps(round_id,page,content)
        SELECT ?,json_extract(value,'$.page'),json_extract(value,'$.content') FROM json_each(?)`).bind(round.id,JSON.stringify(pages)).run();
    }
    await env.DB.prepare('UPDATE rounds SET revealed=1 WHERE id=?').bind(round.id).run();
  }
}
export async function publishResults(env: Env) {
  const pending = await env.DB.prepare('SELECT * FROM guesses WHERE published_id IS NULL LIMIT 2').all<Guess>();
  for (const guess of pending.results) {
    await withLease(env,`result:${guess.interaction_id}`,async () => {
      const latest = await env.DB.prepare('SELECT published_id FROM guesses WHERE interaction_id=?').bind(guess.interaction_id).first<Guess>();
      if (latest?.published_id) return;
      const marker = `Result ${guess.interaction_id}`;
      const found = await existingPost(env,marker);
      const round=await env.DB.prepare('SELECT * FROM rounds WHERE id=?').bind(guess.round_id).first<Round>();
      if(!round)return;
      const payload=resultPayload(guess,round);
      const message = found ? {id:found} : await discord<{id:string}>(env,`/channels/${env.GAME_CHANNEL_ID}/messages`,'POST',{
        ...payload,embeds:payload.embeds.map(e=>({...e,url:`https://discord.com/channels/${env.GUILD_ID}/${env.GAME_CHANNEL_ID}/${round.discord_id}#${encodeURIComponent(marker)}`})),
        nonce:await nonce(marker),enforce_nonce:true,
      });
      await env.DB.prepare('UPDATE guesses SET published_id=? WHERE interaction_id=?').bind(message.id,guess.interaction_id).run();
    });
  }
}
export async function maintenance(env: Env) {
  await withLease(env,'maintenance',async () => {
    await revealOldRounds(env);
    await publishResults(env);
    await publishRecaps(env);
    await syncHistory(env);
    const round = await createRound(env);
    if (round) await publishRound(env,round);
    await refreshPreview(env);
    await setState(env,'last_success',new Date().toISOString());
  });
}

export async function publishRecaps(env: Env) {
  const pending=await env.DB.prepare('SELECT * FROM recaps WHERE published_id IS NULL ORDER BY round_id,page LIMIT 1').all<{round_id:string;page:number;content:string}>();
  for(const recap of pending.results) {
    const marker=`Recap ${recap.round_id} / ${recap.page+1}`;
    const found=await existingPost(env,marker);
    const round=await env.DB.prepare('SELECT * FROM rounds WHERE id=?').bind(recap.round_id).first<Round>();
    if(!round)continue;
    const payload=recapPayload(round,recap.content,recap.page);
    const message=found?{id:found}:await discord<{id:string}>(env,`/channels/${env.GAME_CHANNEL_ID}/messages`,'POST',{
      ...payload,embeds:payload.embeds.map(e=>({...e,url:`https://discord.com/channels/${env.GUILD_ID}/${env.GAME_CHANNEL_ID}/${round.discord_id}#${encodeURIComponent(marker)}`})),
      nonce:await nonce(marker),enforce_nonce:true,
    });
    await env.DB.prepare('UPDATE recaps SET published_id=? WHERE round_id=? AND page=?').bind(message.id,recap.round_id,recap.page).run();
  }
}

// Native previews can take a moment. Use verified metadata only if Discord did
// not unfurl the link itself; never overwrite a native YouTube/video player.
export async function refreshPreview(env: Env) {
  const round=await env.DB.prepare("SELECT * FROM rounds WHERE status='open' AND discord_id IS NOT NULL AND created_at < datetime('now','-1 minute') AND json_array_length(media_json,'$.previews')>0 ORDER BY created_at DESC LIMIT 1").first<Round>();
  if(!round)return;
  const message=await discord<Message>(env,`/channels/${env.GAME_CHANNEL_ID}/messages/${round.discord_id}`);
  const media=parseMedia(round.media_json);
  if(message.embeds?.some(e=>e.url||e.title||e.description))return;
  const images=(media.attachments||[]).filter(a=>a.content_type?.startsWith('image/')).map(a=>({image:{url:a.url}}));
  await discord(env,`/channels/${env.GAME_CHANNEL_ID}/messages/${round.discord_id}`,'PATCH',{embeds:[...images,...(media.previews||[])],allowed_mentions:noMentions});
}
