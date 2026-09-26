import type { Message, Round } from './types';
export function gameDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function eligibleMessage(message: Message): boolean {
  return !message.author.bot && !message.webhook_id && [0, 19].includes(message.type)
    && message.content.trim().length > 0 && message.content.length <= 3500;
}
export function displayQuote(content: string): string {
  // Preserve the words while preventing mentions, links, and Discord markdown tricks.
  return content.replace(/<@!?\d+>/g, '@someone').replace(/<@&\d+>/g, '@role')
    .replace(/<#\d+>/g, '#channel').replace(/@everyone|@here/g, '@everyone')
    .replace(/https?:\/\/\S+/g, '[link]').replace(/([\\`*_~|>\[\]])/g, '\\$1');
}
export function roundPayload(round: Round, revealed = false, total = 0, correct = 0, guildId = '', sourceChannel = '') {
  const title = round.practice ? 'Cathedral Guesser · Practice' : `Cathedral Guesser · ${round.day}`;
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      color: revealed ? 0x728475 : 0xbda477,
      title,
      description: `“${displayQuote(round.content)}”` + (revealed
        ? `\n\n**Written by <@${round.author_id}>**\n${correct} of ${total} players guessed correctly.\n[Original message](https://discord.com/channels/${guildId}/${sourceChannel}/${round.source_id})`
        : '\n\n**Who said it?** One guess. No takebacks.\nChoose privately below; your right/wrong result will appear here. The author is revealed when the day ends.'),
      footer: { text: `Round ${round.id} · ${revealed ? 'Closed' : 'Resets at midnight Eastern'}` },
    }],
    components: revealed ? [] : [{ type: 1, components: [{type: 2, style: 1, label: 'Make my guess', custom_id: `play:${round.id}`}]}],
  };
}
