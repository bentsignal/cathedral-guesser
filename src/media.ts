import type { Attachment, Media, Message, Preview } from './types';

export function publicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      && !url.port && url.hostname.includes('.') && !url.hostname.includes(':')
      && !/^[\d.]+$/.test(url.hostname)
      && !/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(url.hostname);
  } catch { return false; }
}
export function links(content: string): string[] {
  return [...new Set((content.match(/https?:\/\/[^\s<>`]+/g) || []).map(url=>{
    url=url.replace(/[.,!?;]+$/,'');
    while(url.endsWith(')') && (url.match(/\)/g)||[]).length>(url.match(/\(/g)||[]).length)url=url.slice(0,-1);
    return url;
  }))];
}
export function supportedAttachments(message: Message): Attachment[] {
  return (message.attachments || []).filter(a=>/^(image|video)\//.test(a.content_type || '') && publicUrl(a.url));
}
export function parseMedia(json?: string): Media {
  try { return JSON.parse(json || '{}'); } catch { return {}; }
}
async function readLimited(response: Response): Promise<string> {
  const reader=response.body?.getReader(); if(!reader) return '';
  const chunks: Uint8Array[]=[]; let size=0;
  try {
    while(size<65536) { const {done,value}=await reader.read(); if(done) break; const chunk=value.slice(0,65536-size);chunks.push(chunk);size+=chunk.length; }
  } finally { await reader.cancel(); }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder().decode(bytes);
}
export async function checkedFetch(url: string, method='GET', deadline=Date.now()+4000): Promise<Response> {
  for(let redirects=0;redirects<=3;redirects++) {
    if(Date.now()>=deadline)throw new Error('Link check timed out');
    if(!publicUrl(url)) throw new Error('Unsafe link');
    const response=await fetch(url,{method,redirect:'manual',signal:AbortSignal.timeout(Math.max(1,Math.min(4000,deadline-Date.now()))),headers:{'User-Agent':'CathedralGuesser/1.0 (link availability check)'}});
    if([301,302,303,307,308].includes(response.status)) {
      const location=response.headers.get('location'); await response.body?.cancel();
      if(!location) throw new Error('Missing redirect');
      url=new URL(location,url).href;continue;
    }
    if(!response.ok){await response.body?.cancel();throw new Error('Unavailable link');}
    return response;
  }
  throw new Error('Too many redirects');
}
function decode(text: string): string {
  return text.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>Number(n)<=0x10ffff?String.fromCodePoint(Number(n)):'');
}
export function openGraph(html: string, url: string): Preview | undefined {
  const tags:Record<string,string>={};
  for(const tag of html.match(/<meta\b[^>]*>/gi)||[]) {
    const attrs:Record<string,string>={};
    for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) attrs[match[1].toLowerCase()]=decode(match[3]);
    const key=attrs.property||attrs.name;if(key && attrs.content) tags[key.toLowerCase()]=attrs.content;
  }
  const title=tags['og:title']||tags['twitter:title'];
  const description=tags['og:description']||tags['twitter:description'];
  let image=tags['og:image']||tags['twitter:image'];
  if(image) {try{image=new URL(image,url).href;}catch{image='';}}
  if(!title&&!description&&!image)return undefined;
  return {url,title:title?.slice(0,256),description:description?.slice(0,1600),...(image&&publicUrl(image)?{image:{url:image}}:{})};
}
export async function validateMedia(message: Message): Promise<Media | null> {
  const urls=links(message.content);
  const attachments=supportedAttachments(message);
  if(urls.length>3 || attachments.length>4) return null;
  const previews:Preview[]=[];
  const deadline=Date.now()+10000;
  try {
    for(const url of urls) {
      if(!publicUrl(url))return null;
      const parsed=new URL(url),host=parsed.hostname.replace(/^www\./,'');
      // A 200 response from a social site's login shell does not prove the post exists.
      if(['youtube.com','m.youtube.com','youtu.be'].includes(host)) {
        const response=await checkedFetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,'GET',deadline);
        const data=JSON.parse(await readLimited(response));
        if(!data.title||!data.thumbnail_url)return null;
        previews.push({url,title:String(data.title).slice(0,256),author:{name:String(data.author_name||'YouTube')},thumbnail:publicUrl(data.thumbnail_url)?{url:data.thumbnail_url}:undefined});
      } else if(['twitter.com','x.com','mobile.twitter.com'].includes(host) && /\/status\/\d+/.test(parsed.pathname)) {
        const response=await checkedFetch(`https://publish.twitter.com/oembed?url=${encodeURIComponent(url.replace('://x.com/', '://twitter.com/'))}&omit_script=true`,'GET',deadline);
        const data=JSON.parse(await readLimited(response));
        if(!data.html||!data.author_name)return null;
        const description=decode((String(data.html).match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]||'').replace(/<[^>]+>/g,'')).slice(0,1600);
        const cached=message.embeds?.find(e=>e.description);
        previews.push({url,description,author:{name:String(data.author_name).slice(0,256)},...(cached?.image&&publicUrl(cached.image.url)?{image:cached.image}:{})});
      } else {
        const response=await checkedFetch(url,'GET',deadline);
        const type=response.headers.get('content-type')||'';
        if(type.includes('text/html')) {
          const html=await readLimited(response);
          if(/<title[^>]*>\s*(404|not found|page not found|access denied|just a moment)/i.test(html))return null;
          const preview=openGraph(html,url);if(preview)previews.push(preview);
        } else { await response.body?.cancel(); }
      }
    }
    // Fresh URLs come from Discord's source-message fetch, never an expired archive URL.
    for(const attachment of attachments) {
      const host=new URL(attachment.url).hostname;
      if(!['cdn.discordapp.com','media.discordapp.net'].includes(host))return null;
      const response=await checkedFetch(attachment.url,'HEAD',deadline);await response.body?.cancel();
    }
    return {attachments,previews};
  } catch { return null; }
}
