export interface Env {
  DB: D1Database;
  TEST_DB?: D1Database;
  TEST_CHANNEL_ID?: string;
  DISCORD_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  GUILD_ID: string;
  SOURCE_CHANNEL_ID: string;
  GAME_CHANNEL_ID: string;
  TIME_ZONE: string;
}
export interface User { id: string; username: string; global_name?: string; bot?: boolean }
export interface Member { user: User; nick?: string; permissions?: string }
export interface Attachment { id: string; url: string; filename: string; content_type?: string; size?: number }
export interface Preview { title?: string; description?: string; url?: string; type?: string; image?: {url:string}; thumbnail?: {url:string}; author?: {name:string;url?:string}; footer?: {text:string} }
export interface Media { attachments?: Attachment[]; previews?: Preview[] }
export interface Message {
  id: string; content: string; author: User; timestamp: string;
  type: number; webhook_id?: string; embeds?: Preview[]; attachments?: Attachment[];
  components?: {components?: {custom_id?:string}[]}[];
}
export interface Round {
  id: string; day: string; practice: number; source_id: string; author_id: string;
  content: string; media_json?: string; context_json?: string; eligible_authors_json?: string | null; guess_limit?: number; status: string; discord_id: string | null; revealed: number;
}
export interface Guess {
  round_id: string; user_id: string; guessed_id: string; correct: number;
  interaction_id: string; published_id: string | null; attempts_used?: number;
}
export interface Interaction {
  id: string; application_id: string; token: string; type: number;
  guild_id?: string; channel_id?: string; member?: Member;
  data?: { name?: string; custom_id?: string; values?: string[]; options?: {name: string; value?: string; options?: {name:string;value?:string}[]}[] };
}
