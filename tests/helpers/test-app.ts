import { buildApp as buildServer, type BuildAppOptions } from '../../src/server/app.js';
import { FakeCreatorProfileSource } from './fake-creator-profile-source.js';
import { FakeGuardRosterSource } from './fake-guard-roster-source.js';
import { FakeLiveMessageSource } from './fake-live-message-source.js';

/** Tests replace only Bilibili boundaries; application services remain real. */
export function buildApp(options: BuildAppOptions = {}) {
  return buildServer({
    creatorProfileSource: new FakeCreatorProfileSource(),
    guardRosterSource: new FakeGuardRosterSource(),
    liveMessageSource: new FakeLiveMessageSource(),
    ...options,
  });
}
