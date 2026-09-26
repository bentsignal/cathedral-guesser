import type { Message, Round, Guess } from './types';
import { links, parseMedia, supportedAttachments } from './media';
export function gameDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function isCommand(content:string):boolean {
  return /^(?:\/|[!?.$;~][a-z][\w-]*(?:\s|$)|<@!?\d+>\s*[a-z])/i.test(content.trim());
}
export function eligibleMessage(message: Message): boolean {
  return !isCommand(message.content) && !message.author.bot && !message.webhook_id && [0, 19].includes(message.type)
    && (message.content.trim().length > 0 || supportedAttachments(message).length > 0)
    && message.content.length <= 3500 && displayQuote(message.content).length <= 3500;
}
export function displayQuote(content: string): string {
  const text=content.replace(/<@!?\d+>/g, '@someone').replace(/<@&\d+>/g, '@role').replace(/<#\d+>/g, '#channel')
    .replace(/<(https?:\/\/[^>]+)>/g,'$1');
  return text.split(/(https?:\/\/[^\s<>]+)/g).map(part=>/^https?:\/\//.test(part)?part:part.replace(/([\\`*_~|>\[\]])/g,'\\$1')).join('');
}
export function roundTitle(round: Pick<Round,'day'|'practice'>): string {
  return `Cathedral Guesser · ${round.day}${round.practice?' · Practice':''}`;
}
export function roundPayload(round: Round, revealed = false, _total = 0, _correct = 0, guildId = '', sourceChannel = '') {
  const media=parseMedia(round.media_json);
  const quote=displayQuote(round.content);
  const videoLinks=(media.attachments||[]).filter(a=>a.content_type?.startsWith('video/')).map(a=>a.url);
  const images=(media.attachments||[]).filter(a=>a.content_type?.startsWith('image/')).map(a=>({...(round.context_json&&round.context_json!=='{}'?{title:'➡ Guess this image'}:{}),image:{url:a.url}}));
  const long=quote.length>900;
  const header=`**${round.day}**${round.practice?' · Practice':''}`;
  const body=long?links(round.content).join('\n'):quote;
  // Quote plain text visually; leave links unwrapped for Discord's native previews.
  const excerpt=body && !links(round.content).length && !long?body.split('\n').map(line=>`> ${line}`).join('\n'):body;
  let context:{before?:string;after?:string}={};try{context=JSON.parse(round.context_json||'{}');}catch{}
  const contextLine=(label:string,text?:string)=>text?`-# ${label}\n${displayQuote(text).split('\n').map(line=>`> ${line}`).join('\n')}`:'';
  const hasContext=!!(context.before||context.after);
  const content=[header,contextLine('Before',context.before),hasContext?'**➡ Guess this message**':'',excerpt,...videoLinks,contextLine('After',context.after),
    revealed?`**Sent by** <@${round.author_id}> · [Original message](https://discord.com/channels/${guildId}/${sourceChannel}/${round.source_id})`:'**Who sent it?**'].filter(Boolean).join('\n\n');
  return {
    content,
    allowed_mentions: { parse: [] },
    embeds:[...(long?[{title:'➡ Guess this message',description:quote}]:[]),...images],
    components: revealed ? [] : [{ type: 1, components: [{type: 2, style: 1, label: 'Guess', custom_id: `play:${round.id}`}]}],
  };
}
export function resultSquares(correct:number,used=1,limit=3):string {
  return '🟥'.repeat(Math.max(0,used-(correct?1:0)))+(correct?'🟩':'')+'⬜'.repeat(Math.max(0,limit-used));
}
export function resultPayload(guess: Guess, round: Round) {
  return {allowed_mentions:{parse:[]},embeds:[{description:`<@${guess.user_id}> ${guess.correct?'got it right.':'got it wrong.'}${(round.guess_limit||1)>1?`\n${resultSquares(guess.correct,guess.attempts_used||1,round.guess_limit)} ${guess.correct?guess.attempts_used||1:'X'}/${round.guess_limit}`:''}`,footer:{text:roundTitle(round)},color:guess.correct?0x57b382:0xca7a76}]};
}
export function recapPages(_day: string, players: {user_id:string;correct:number;attempts_used?:number}[],limit=1): string[] {
  const correct=players.filter(p=>p.correct===1),wrong=players.filter(p=>p.correct!==1);
  const pages:string[]=[];let page='';
  for(const [label,group] of [['Correct',correct],['Incorrect',wrong]] as const) {
    const heading=`**${label} (${group.length})**`;
    if(page.length+heading.length+30>3500){pages.push(page);page='';}
    page+=(page?'\n\n':'')+heading;
    for(const player of group) {
      const line=`\n<@${player.user_id}>${limit>1?` · ${resultSquares(player.correct,player.attempts_used||1,limit)}`:''}`;
      if(page.length+line.length>3500){pages.push(page);page=heading;}
      page+=line;
    }
  }
  if(page)pages.push(page);return pages;
}
export function recapPayload(round: Round, content: string, page: number) {
  return {allowed_mentions:{parse:[]},embeds:[{title:`${roundTitle(round)} · Recap${page?' (continued)':''}`,color:0xbda477,description:content}]};
}
