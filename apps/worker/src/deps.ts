import type { ChannelProvider, PerKeyRateLimiter } from '@v01/channels';
import type { WorkerDatabase } from '@v01/db';
import type { AlertSink } from '@v01/integrations';

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface WorkerDeps {
  db: WorkerDatabase;
  provider: ChannelProvider;
  limiter: PerKeyRateLimiter;
  alerts: AlertSink;
  log: Logger;
}

export const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};
