import type { Clock } from '../clock/clock.js';

export type RuntimeState = 'STARTING' | 'RUNNING' | 'DEGRADED' | 'STOPPED';

export interface RuntimeStatus {
  readonly lastErrorAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly lastSuccessAt: Date | null;
  readonly lastTickAt: Date | null;
  readonly nextRetryAt: Date | null;
  readonly startedAt: Date | null;
  readonly state: RuntimeState;
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code.slice(0, 120);
  }
  if (error instanceof Error && error.name) return error.name.slice(0, 120);
  return 'RUNTIME_ERROR';
}

export class RuntimeStatusTracker {
  private status: RuntimeStatus = {
    lastErrorAt: null,
    lastErrorCode: null,
    lastSuccessAt: null,
    lastTickAt: null,
    nextRetryAt: null,
    startedAt: null,
    state: 'STOPPED',
  };

  public constructor(private readonly clock: Clock) {}

  public get(): RuntimeStatus {
    return { ...this.status };
  }

  public markStarting(): void {
    const now = this.clock.now();
    this.status = {
      ...this.status,
      nextRetryAt: null,
      startedAt: this.status.startedAt ?? now,
      state: 'STARTING',
    };
  }

  public markSuccess(tick = true): void {
    const now = this.clock.now();
    this.status = {
      ...this.status,
      lastErrorCode: null,
      lastSuccessAt: now,
      ...(tick ? { lastTickAt: now } : {}),
      nextRetryAt: null,
      startedAt: this.status.startedAt ?? now,
      state: 'RUNNING',
    };
  }

  public markFailure(error: unknown, nextRetryAt: Date, tick = true): void {
    const now = this.clock.now();
    this.status = {
      ...this.status,
      lastErrorAt: now,
      lastErrorCode: errorCode(error),
      ...(tick ? { lastTickAt: now } : {}),
      nextRetryAt,
      startedAt: this.status.startedAt ?? now,
      state: 'DEGRADED',
    };
  }

  public markStopped(): void {
    this.status = {
      ...this.status,
      nextRetryAt: null,
      state: 'STOPPED',
    };
  }
}
