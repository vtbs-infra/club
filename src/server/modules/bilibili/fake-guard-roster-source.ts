import type {
  FetchGuardRosterPageInput,
  GuardRosterMember,
  GuardRosterPage,
  GuardRosterSource,
} from './guard-roster-source.js';

export interface FakeRosterScenario {
  readonly pages: ReadonlyMap<number, GuardRosterPage>;
  readonly refetchedFirstPage?: GuardRosterPage;
}

export function buildFakeRosterScenario(
  members: readonly GuardRosterMember[],
  pageSize = 30,
): FakeRosterScenario {
  const pageCount = Math.max(1, Math.ceil(members.length / pageSize));
  const pages = new Map<number, GuardRosterPage>();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const pageMembers = members.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
    const payload = {
      data: { members: pageMembers, pageCount, pageNumber, total: members.length },
    };
    pages.set(pageNumber, {
      declaredPageCount: pageCount,
      declaredTotal: members.length,
      fetchedAt: new Date('2026-07-31T15:59:00.000Z'),
      members: pageMembers,
      pageNumber,
      rawBytes: new TextEncoder().encode(JSON.stringify(payload)),
    });
  }
  return { pages };
}

export class FakeGuardRosterSource implements GuardRosterSource {
  public readonly name = 'fake';
  public readonly version = '1';
  private scenario: FakeRosterScenario = buildFakeRosterScenario([]);
  private pageOneRequests = 0;

  public setScenario(scenario: FakeRosterScenario): void {
    this.scenario = scenario;
    this.pageOneRequests = 0;
  }

  public async fetchPage(input: FetchGuardRosterPageInput): Promise<GuardRosterPage> {
    if (input.signal.aborted) throw input.signal.reason;
    if (input.pageNumber === 1) this.pageOneRequests += 1;
    const page =
      input.pageNumber === 1 && this.pageOneRequests > 1 && this.scenario.refetchedFirstPage
        ? this.scenario.refetchedFirstPage
        : this.scenario.pages.get(input.pageNumber);
    if (!page) throw new Error(`Fake roster page ${input.pageNumber} is missing.`);
    return Promise.resolve(page);
  }
}
