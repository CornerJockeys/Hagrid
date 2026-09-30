export interface D1RunResult {
  success: boolean;
}

export interface D1QueryResult<T> extends D1RunResult {
  results: T[];
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1QueryResult<T>>;
  run(): Promise<D1RunResult>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1RunResult[]>;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface ScheduledEventLike {
  scheduledTime: number;
  cron: string;
}

export interface Env {
  DB: D1Database;
  DISCORD_PUBLIC_KEY: string;
  SPROCKET_DATASET_BASE_URL?: string;
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

export interface DiscordAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  proxy_url?: string;
  content_type?: string;
}

export interface DiscordResolvedData {
  attachments?: Record<string, DiscordAttachment>;
}

export interface DiscordInteractionData {
  name?: string;
  options?: DiscordCommandOption[];
  resolved?: DiscordResolvedData;
}

export interface DiscordInteraction {
  id?: string;
  application_id?: string;
  token?: string;
  type: number;
  guild_id?: string;
  member?: DiscordMember;
  user?: DiscordUser;
  data?: DiscordInteractionData;
}
