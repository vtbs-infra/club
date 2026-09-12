import type { GuardRosterMember, GuardRosterPage } from '../bilibili/guard-roster-source.js';

export class CaptureFailure extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type CapturedRosterPage = Omit<GuardRosterPage, 'rawBytes'>;
type CapturedRosterMember = GuardRosterMember & { readonly sourcePage: number };

function fingerprint(page: Pick<GuardRosterPage, 'members'>): string {
  return page.members
    .map((member) => `${member.biliUid}:${member.rawTier}:${member.sourcePosition}`)
    .join('|');
}

export function validateRosterPages(
  pages: readonly CapturedRosterPage[],
  recheck: CapturedRosterPage,
): readonly (CapturedRosterMember & {
  readonly tier: NonNullable<GuardRosterMember['tier']>;
})[] {
  const first = pages[0];
  if (!first) throw new CaptureFailure('MISSING_PAGE', 'The first roster page is missing.');
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]!;
    if (page.pageNumber !== index + 1) {
      throw new CaptureFailure('MISSING_PAGE', 'A roster page was missing or out of order.');
    }
    if (
      page.declaredPageCount !== first.declaredPageCount ||
      page.declaredTotal !== first.declaredTotal
    ) {
      throw new CaptureFailure('COUNT_DRIFT', 'Roster totals changed during pagination.');
    }
  }
  if (
    recheck.declaredPageCount !== first.declaredPageCount ||
    recheck.declaredTotal !== first.declaredTotal ||
    fingerprint(recheck) !== fingerprint(first)
  ) {
    throw new CaptureFailure('FIRST_PAGE_DRIFT', 'The first roster page changed during capture.');
  }
  const members = pages
    .flatMap((page) => page.members.map((member) => ({ ...member, sourcePage: page.pageNumber })))
    .map((member) => {
      if (member.tier === null) {
        throw new CaptureFailure('UNKNOWN_TIER', 'The provider returned an unknown guard tier.');
      }
      return { ...member, tier: member.tier };
    });
  if (new Set(members.map((member) => member.biliUid)).size !== members.length) {
    throw new CaptureFailure('DUPLICATE_UID', 'The roster contained a duplicate UID.');
  }
  if (members.length !== first.declaredTotal) {
    throw new CaptureFailure('COUNT_MISMATCH', 'The normalized roster did not match its total.');
  }
  return members;
}
