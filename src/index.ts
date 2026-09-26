import type { Env, Interaction, Round, Guess } from './types';
import { discord, noMentions, verifySignature } from './discord';
import { gameDay } from './game';
import { createRound, currentMember, maintenance, publishResults, publishRound, publishRecaps, revealOldRounds, state, withLease } from './storage';

const reply = (content: string, components: unknown[] = []) => ({content,components,allowed_mentions:noMentions});
async function editReply(env: Env, i: Interaction, body: unknown) {
  await discord(env,`/webhooks/${env.DISCORD_APPLICATION_ID}/${i.token}/messages/@original`,'PATCH',body);
}
async function showSelector(env: Env, i: Interaction, roundId: string) {
  const round = await env.DB.prepare('SELECT * FROM rounds WHERE id=?').bind(roundId).first<Round>();
  if (!round || round.status !== 'open' || round.day !== gameDay(new Date(),env.TIME_ZONE)) {
    return reply('This round is closed or not ready yet. Look for today’s puzzle in the game channel.');
  }
  const existing = await env.DB.prepare('SELECT * FROM guesses WHERE round_id=? AND user_id=?').bind(roundId,i.member!.user.id).first<Guess>();
  if (existing) return reply(`You already used your one guess. ${existing.correct?'Correct.':'Incorrect.'}`);
  return reply('**Who sent it?**\nOne guess. Selecting a name submits it.',[
    {type:1,components:[{type:5,custom_id:`guess:${round.id}`,placeholder:'Choose someone',min_values:1,max_values:1}]},
  ]);
}
export const INSERT_GUESS = `INSERT INTO guesses(round_id,user_id,guessed_id,correct,interaction_id)
  SELECT id,?,?,CASE WHEN author_id=? THEN 1 ELSE 0 END,? FROM rounds
  WHERE id=? AND day=? AND status='open'
  ON CONFLICT DO NOTHING RETURNING *`;
async function submitGuess(env: Env, i: Interaction, roundId: string) {
  const guessed = i.data?.values?.[0];
  if (!guessed || !/^\d{17,20}$/.test(guessed) || i.data?.values?.length!==1) return reply('Choose one server member.');
  if (!(await currentMember(env,guessed))) {
    const selector = await showSelector(env,i,roundId);
    return {...selector,content:'That person is not a current human member of this server. Your guess has not been used. Choose someone else.'};
  }
  const userId = i.member!.user.id;
  const saved = await env.DB.prepare(INSERT_GUESS)
    .bind(userId,guessed,guessed,i.id,roundId,gameDay(new Date(),env.TIME_ZONE)).first<Guess>();
  if (!saved) {
    const previous = await env.DB.prepare('SELECT * FROM guesses WHERE round_id=? AND user_id=?').bind(roundId,userId).first<Guess>();
    return reply(previous ? `Your guess was already locked in. ${previous.correct?'🟩 Correct!':'🟥 Incorrect.'} You get one guess per round.` : 'This round has ended. Your guess was not recorded.');
  }
  return reply(`${saved.correct?'Correct.':'Incorrect.'}`);
}
function isAdmin(i: Interaction) {
  const permissions = BigInt(i.member?.permissions || '0');
  return (permissions & 8n)!==0n || (permissions & 32n)!==0n;
}
async function command(env: Env, i: Interaction) {
  const sub = i.data?.options?.[0]?.name || 'play';
  if (sub==='play') return showSelector(env,i,gameDay(new Date(),env.TIME_ZONE));
  if (sub==='help') return reply('**Cathedral Guesser**\nEvery day at midnight Eastern, a historical message becomes a new puzzle. Click **Make my guess**, then pick a current server member. Selection is final: one guess per round.\n\n🟩 / 🟥 results are public; your selection stays private. The author and original message are revealed when the day ends.\n\n`/guesser stats` · your record\n`/guesser leaderboard` · server standings\n`/guesser status` · import and bot health\nAdmins can use `/guesser sync`, `/guesser practice`, and `/guesser finish-practice` for testing. Practice does not affect daily standings.');
  if (sub==='stats') {
    const stats = await env.DB.prepare(`SELECT COUNT(*) AS played, COALESCE(SUM(g.correct),0) AS wins FROM guesses g
      JOIN rounds r ON r.id=g.round_id WHERE g.user_id=? AND r.practice=0`).bind(i.member!.user.id).first<{played:number;wins:number}>();
    return reply(`**Your Cathedral Guesser record**\nPlayed: **${stats!.played}** · Correct: **${stats!.wins}** · Incorrect: **${stats!.played-stats!.wins}** · Accuracy: **${stats!.played?Math.round(stats!.wins/stats!.played*100):0}%**`);
  }
  if (sub==='leaderboard') {
    const rows = await env.DB.prepare(`SELECT g.user_id,COUNT(*) AS played,SUM(g.correct) AS wins FROM guesses g
      JOIN rounds r ON r.id=g.round_id WHERE r.practice=0 GROUP BY g.user_id ORDER BY wins DESC,played ASC,g.user_id LIMIT 10`).all<{user_id:string;played:number;wins:number}>();
    return reply('**Cathedral Guesser · Daily standings**\n'+(rows.results.map((r,n)=>`${['🥇','🥈','🥉'][n] || `${n+1}.`} <@${r.user_id}> — **${r.wins}** correct · ${r.played-r.wins} incorrect`).join('\n')||'No daily guesses yet. Be the first!'));
  }
  if (sub==='status') {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM messages').first<number>('n');
    return reply(`**Bot status**\nMessages archived: **${count}**\nHistory import: **${await state(env,'history_complete')?'complete':'in progress (100 messages every five minutes)'}**\nLast successful maintenance: ${await state(env,'last_success')||'not yet'}\nDaily reset: **midnight America/New_York**\nGame: <#${env.GAME_CHANNEL_ID}>`);
  }
  if (!isAdmin(i)) return reply('You need Manage Server permission to use this command.');
  if (sub==='sync') {
    await maintenance(env);
    return reply('Maintenance requested: import a page of history, retry pending results, and post today’s puzzle when the full archive is ready. Use `/guesser status` to check progress.');
  }
  if (sub==='finish-practice') {
    const ended=await withLease(env,'maintenance',async()=> {
      const active=await env.DB.prepare("SELECT id FROM rounds WHERE practice=1 AND status='open' ORDER BY created_at DESC,id DESC LIMIT 1").first<{id:string}>();
      if (!active) return false;
      await env.DB.prepare("UPDATE rounds SET status='closed' WHERE id=?").bind(active.id).run();
      await revealOldRounds(env);
      await publishRecaps(env);
      return true;
    });
    return reply(ended?'Practice closed.':'No open practice round found, or maintenance is running.');
  }
  if (sub==='practice') {
    const round = await withLease(env,'maintenance',async()=> {
      const input=i.data?.options?.[0]?.options?.find(o=>o.name==='message')?.value;
      const sourceId=input?.match(/(?:^|\/)(\d{17,20})$/)?.[1];
      if(input && !sourceId)throw new Error('Invalid message ID');
      const r = await createRound(env,`practice-${i.id}`,sourceId);
      if (r) await publishRound(env,r);
      return r;
    });
    return reply(round?'Practice posted.':'No playable message found. Links may be unavailable, or history is still importing. Try another message.');
  }
  return reply('Unknown command. Try `/guesser help`.');
}
async function handle(env: Env, i: Interaction) {
  try {
    let body;
    if (i.type===2) body=await command(env,i);
    else {
      const [action,...parts]=(i.data?.custom_id||'').split(':');
      const id=parts.join(':');
      if (action==='play') body=await showSelector(env,i,id);
      else if (action==='guess') body=await submitGuess(env,i,id);
      else body=reply('That control is no longer supported. Try `/guesser play`.');
    }
    await editReply(env,i,body);
    if (i.data?.custom_id?.startsWith('guess:')) {
      try { await publishResults(env); }
      catch { console.error('Public result delivery deferred to scheduled retry'); }
    }
  } catch (error) {
    console.error('Interaction failed',error instanceof Error ? error.name : 'UnknownError');
    // Do not claim a failed request necessarily means no guess was recorded.
    try { await editReply(env,i,reply('Something went wrong while finishing that request. Your guess may already be saved; use **Make my guess** to check. Saved guesses cannot be changed.')); }
    catch { console.error('Unable to deliver private error response'); }
  }
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method==='GET' && path==='/health') return Response.json({ok:true,service:'cathedral-guesser'});
    if (request.method!=='POST' || path!=='/interactions') return new Response('Not found',{status:404});
    if (Number(request.headers.get('content-length')||0)>131072) return new Response('Too large',{status:413});
    const body=await request.text();
    if (body.length>131072) return new Response('Too large',{status:413});
    if (!(await verifySignature(request,body,env.DISCORD_PUBLIC_KEY))) return new Response('Invalid signature',{status:401});
    let interaction: Interaction;
    try { interaction=JSON.parse(body); } catch { return new Response('Invalid JSON',{status:400}); }
    if (interaction.type===1) return Response.json({type:1});
    if (interaction.application_id!==env.DISCORD_APPLICATION_ID || interaction.guild_id!==env.GUILD_ID || !interaction.member || interaction.member.user.bot) {
      return Response.json({type:4,data:{...reply('This bot is configured for a different server.'),flags:64}});
    }
    if (![2,3].includes(interaction.type)) return Response.json({type:4,data:{...reply('Unsupported interaction.'),flags:64}});
    ctx.waitUntil(handle(env,interaction));
    // Guess controls exist only in ephemeral messages. Update that private message
    // and remove the selector after submission; never edit the shared puzzle here.
    return Response.json(interaction.data?.custom_id?.startsWith('guess:') ? {type:6} : {type:5,data:{flags:64}});
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(maintenance(env).catch(error=> {
      console.error('Maintenance failed',error instanceof Error ? error.name : 'UnknownError');
      throw error;
    }));
  },
} satisfies ExportedHandler<Env>;
