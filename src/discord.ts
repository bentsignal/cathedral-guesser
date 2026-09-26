import type { Env } from './types';
export class DiscordError extends Error {
  constructor(public status: number, public retryAfter = 0) { super(`Discord API returned ${status}`); }
}
export async function discord<T>(env: Env, path: string, method = 'GET', body?: unknown): Promise<T> {
  if(method.toUpperCase()==='DELETE' || path.split('?')[0].endsWith('/bulk-delete')) throw new Error('Discord deletion is prohibited');
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bot ${env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // Never log response bodies, interaction tokens, or authorization headers.
    const retry = Number(response.headers.get('retry-after') || 0);
    throw new DiscordError(response.status, retry);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}
export const noMentions = { parse: [] as string[] };
export async function verifySignature(request: Request, body: string, publicKey: string): Promise<boolean> {
  const sig = request.headers.get('x-signature-ed25519') || '';
  const timestamp = request.headers.get('x-signature-timestamp') || '';
  if (!/^[a-f0-9]{128}$/i.test(sig) || !/^[a-f0-9]{64}$/i.test(publicKey) || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  try {
    const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (v) => parseInt(v, 16));
    const key = await crypto.subtle.importKey('raw', bytes(publicKey), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, bytes(sig), new TextEncoder().encode(timestamp + body));
  } catch { return false; }
}
export async function nonce(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash).slice(0, 12), n => n.toString(16).padStart(2, '0')).join('');
}
