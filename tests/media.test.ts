import {afterEach,describe,expect,it,vi} from 'vitest';
import {checkedFetch,links,openGraph,publicUrl,validateMedia} from '../src/media';
import {eligibleMessage,roundPayload,recapPayload,resultPayload} from '../src/game';
import type {Message,Round} from '../src/types';
const message:Message={id:'1',author:{id:'2',username:'person'},content:'',type:0,timestamp:'2026-09-26'};
const round:Round={id:'private-round-id',day:'2026-09-26',practice:0,source_id:'source',author_id:'author',content:'https://www.youtube.com/watch?v=abc_def',status:'open',discord_id:null,revealed:0};
afterEach(()=>vi.unstubAllGlobals());
describe('clean Discord output',()=>{
  it('shows clickable links in message content, where Discord can unfurl them',()=>{
    const payload=roundPayload(round);
    expect(payload.content).toBe('**2026-09-26**\n\n👤 **???**\n**https://www.youtube.com/watch?v=abc_def**\n\n**Who sent the bolded message?**');
    expect(payload.embeds).toEqual([]);
  });
  it('renders image-only and video-only messages without exposing the sender',()=>{
    const image={id:'image',url:'https://cdn.discordapp.com/attachments/1/2/a.png',filename:'a.png',content_type:'image/png'};
    expect(eligibleMessage({...message,attachments:[image]})).toBe(true);
    const payload=roundPayload({...round,content:'',media_json:JSON.stringify({attachments:[image,{...image,url:'https://cdn.discordapp.com/attachments/1/2/a.mp4',content_type:'video/mp4'}]})});
    expect(payload.embeds[0]).toEqual({image:{url:image.url}});
    expect(payload.content).toContain('a.mp4');
    expect(payload.content).toContain('👤 **???**\n**See attachment below.**');
    expect(JSON.stringify(payload)).not.toContain('Guess this image');
    expect(payload.content).not.toContain('author');
  });
  it('keeps result and recap text minimal with no visible tracking IDs',()=>{
    const result=resultPayload({round_id:round.id,user_id:'player',guessed_id:'author',correct:1,interaction_id:'long-id',published_id:null},round);
    expect(result.embeds[0].description).toBe('<@player> got it right in 1 guess.');
    expect(result.embeds[0].footer.text).toBe('Cathedral Guesser · 2026-09-26');
    expect(JSON.stringify(result)).not.toContain('long-id');
    expect(recapPayload(round,'**Correct (1)**\n<@player>\n\n**Incorrect (0)**',0).embeds[0].title).toBe('Cathedral Guesser · 2026-09-26 · Recap');
  });
});
it('spaces multi-guess results and labels context without revealing the target',()=>{
  const r={...round,guess_limit:3,context_json:JSON.stringify({before:{name:'A *name*',text:'hello'},after:{name:'???',text:'reply'}})};
  const result=resultPayload({round_id:r.id,user_id:'player',guessed_id:'author',correct:1,attempts_used:2,interaction_id:'id',published_id:null},r);
  expect(result.embeds[0].description).toBe('<@player> got it right in 2 guesses.\n\n🟥🟩⬜');
  const content=roundPayload(r).content;
  expect(content).toContain('👤 ???\n> reply');expect(content).toContain('hello');expect(content).not.toContain('<@author>');
});
describe('link availability',()=>{
  it('blocks local addresses, IPs, userinfo, ports and non-HTTP schemes',()=>{
    for(const url of ['http://127.0.0.1','http://2130706433','http://[::1]','http://localhost','http://metadata.internal','http://a:b@public.com','http://public.com:8080','file:///etc/passwd','https://foo.local'])expect(publicUrl(url)).toBe(false);
    expect(publicUrl('https://youtube.com/watch?v=abc')).toBe(true);
  });
  it('never follows redirects into private destinations',async()=>{
    const mock=vi.fn().mockResolvedValue(new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}}));vi.stubGlobal('fetch',mock);
    await expect(checkedFetch('https://public.com')).rejects.toThrow('Unsafe');expect(mock).toHaveBeenCalledTimes(1);
  });
  it('skips dead links and transient access failures',async()=>{
    for(const status of [404,410,403,429,503]) {
      vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status})));
      expect(await validateMedia({...message,content:'https://public.com/post'})).toBeNull();
    }
  });
  it('uses a real YouTube oEmbed response to reject deleted or private videos',async()=>{
    const mock=vi.fn().mockResolvedValue(new Response('',{status:404}));vi.stubGlobal('fetch',mock);
    expect(await validateMedia({...message,content:'https://youtu.be/deleted'})).toBeNull();
    expect(String(mock.mock.calls[0][0])).toContain('youtube.com/oembed');
  });
  it('retains verified tweet author and content for preview fallback',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({author_name:'Someone',html:'<blockquote><p>Some &amp; text</p></blockquote>'})));
    const media=await validateMedia({...message,content:'https://x.com/someone/status/123'});
    expect(media?.previews?.[0]).toMatchObject({author:{name:'Someone'},description:'Some & text'});
  });
  it('extracts Open Graph metadata regardless of attribute order',()=>{
    expect(openGraph('<meta content="A &amp; B" property="og:title"><meta property="og:image" content="/image.png">','https://public.com/post')).toMatchObject({title:'A & B',image:{url:'https://public.com/image.png'}});
  });
  it('deduplicates links and checks fresh Discord attachment URLs',async()=>{
    expect(links('https://public.com/a https://public.com/a')).toEqual(['https://public.com/a']);
    expect(links('[link](https://public.com/a) `https://public.com/b`')).toEqual(['https://public.com/a','https://public.com/b']);
    const mock=vi.fn().mockResolvedValue(new Response(null,{status:200}));vi.stubGlobal('fetch',mock);
    const attachment={id:'2',url:'https://cdn.discordapp.com/attachments/1/2/image.png?ex=fresh',filename:'image.png',content_type:'image/png'};
    expect((await validateMedia({...message,attachments:[attachment]}))?.attachments).toEqual([attachment]);
    expect(mock.mock.calls[0][1].method).toBe('HEAD');
  });
});

it('renders saved media context as placeholders while keeping target media',()=>{
 const image={id:'image',url:'https://cdn.discordapp.com/attachments/1/2/a.png',filename:'a.png',content_type:'image/png'};
 const context={before:{name:'Alice',text:'look',urls:['https://example.com/page'],media:{attachments:[image]}},after:{name:'???',text:'okay'}};
 const payload=roundPayload({...round,content:'',media_json:JSON.stringify({attachments:[image]}),context_json:JSON.stringify(context)});
 expect(payload.content).toContain('🧑 Alice\n> look \\[link\\] \\[Attachment\\]');
 expect(payload.content).not.toContain('example.com');
 expect(payload.content).toContain('👤 **???**\n**See attachment below.**');
 expect(payload.embeds).toEqual([{image:{url:image.url}}]);
});

it('adds original timestamps without exposing an original-message link until reveal',()=>{
 const dated={...round,source_id:'156935745314095105',context_json:JSON.stringify({before:{name:'Alice',text:'before',timestamp:'2016-01-01T00:00:00Z'},after:{name:'???',text:'after',timestamp:'2016-01-01T00:01:00Z'}})};
 const payload=roundPayload(dated);
 expect(payload.content.match(/<t:\d+:f>/g)).toHaveLength(3);
 expect(payload.content).not.toContain('discord.com/channels');
 expect(roundPayload(dated,true,0,0,'guild','source').content).toContain('https://discord.com/channels/guild/source/156935745314095105');
 const recap=recapPayload(dated,'results',0,'guild','source');
 expect(recap.components?.[0].components[0]).toMatchObject({style:5,label:'Original message',url:'https://discord.com/channels/guild/source/156935745314095105'});
});
