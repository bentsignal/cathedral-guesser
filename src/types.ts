export interface Env {
  DB: D1Database;
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
export interface Message {
  id: string; content: string; author: User; timestamp: string;
  type: number; webhook_id?: string; embeds?: { footer?: { text: string } }[];
}
export interface Round {
  id: string; day: string; practice: number; source_id: string; author_id: string;
  content: string; status: string; discord_id: string | null; revealed: number;
}
export interface Guess {
  round_id: string; user_id: string; guessed_id: string; correct: number;
  interaction_id: string; published_id: string | null;
}
export interface Interaction {
  id: string; application_id: string; token: string; type: number;
  guild_id?: string; channel_id?: string; member?: Member;
  data?: { name?: string; custom_id?: string; values?: string[]; options?: {name: string; value?: string}[] };
}
