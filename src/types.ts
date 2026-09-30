export interface D1RunResult {
  success: boolean;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1RunResult>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface Env {
  DB: D1Database;
  DISCORD_PUBLIC_KEY: string;
}

export interface DiscordUser {
  id: string;
  username?: string;
}

export interface DiscordMember {
  permissions?: string;
  user?: DiscordUser;
}

export interface DiscordCommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordCommandOption[];
}

export interface DiscordInteractionData {
  name?: string;
  options?: DiscordCommandOption[];
}

export interface DiscordInteraction {
  id?: string;
  type: number;
  guild_id?: string;
  member?: DiscordMember;
  user?: DiscordUser;
  data?: DiscordInteractionData;
}
