export interface BilibiliReadingSnapshot {
  readonly revision: number;
  readonly uid: string;
  readonly cookies: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export interface BilibiliReadingSession {
  isAvailable(): boolean;
  snapshot(): BilibiliReadingSnapshot;
}
