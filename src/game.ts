import type { Message, Round, Guess } from './types';
import { links, parseMedia, supportedAttachments } from './media';
export function gameDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function eligibleMessage(message: Message): boolean {
  return !message.author.bot && !message.webhook_id && [0, 19].includes(message.type)
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
  const images=(media.attachments||[]).filter(a=>a.content_type?.startsWith('image/')).map(a=>({image:{url:a.url}}));
  const long=quote.length>1400;
  const content=[`**${roundTitle(round)}**`,long?links(round.content).join('\n'):quote,...videoLinks,
    revealed?`Sent by <@${round.author_id}> · [Original message](https://discord.com/channels/${guildId}/${sourceChannel}/${round.source_id})`:'**Who sent it?**'].filter(Boolean).join('\n\n');
  return {
    content,
    allowed_mentions: { parse: [] },
    embeds:[...(long?[{description:quote}]:[]),...images],
    components: revealed ? [] : [{ type: 1, components: [{type: 2, style: 1, label: 'Guess', custom_id: `play:${round.id}`}]}],
  };
}
export function resultPayload(guess: Guess, round: Round) {
  return {allowed_mentions:{parse:[]},embeds:[{description:`<@${guess.user_id}> ${guess.correct?'got it right.':'got it wrong.'}`,footer:{text:roundTitle(round)},color:guess.correct?0x57b382:0xca7a76}]};
}
export function recapPages(_day: string, players: {user_id:string;correct:number}[]): string[] {
  const correct=players.filter(p=>p.correct===1),wrong=players.filter(p=>p.correct!==1);
  const pages:string[]=[];let page='';
  for(const [label,group] of [['Correct',correct],['Incorrect',wrong]] as const) {
    const heading=`**${label} (${group.length})**`;
    if(page.length+heading.length+30>3500){pages.push(page);page='';}
    page+=(page?'\n\n':'')+heading;
    for(const player of group) {
      const line=`\n<@${player.user_id}>`;
      if(page.length+line.length>3500){pages.push(page);page=heading;}
      page+=line;
    }
  }
  if(page)pages.push(page);return pages;
}
export function recapPayload(round: Round, content: string, page: number) {
  return {allowed_mentions:{parse:[]},embeds:[{title:`${roundTitle(round)} · Recap${page?' (continued)':''}`,color:0xbda477,description:content}]};
}
