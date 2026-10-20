/** Platform announcement forms are filled in this zone. */
export const PLATFORM_TIME_ZONE = 'Asia/Shanghai';

/**
 * Shows an instant as the `YYYY-MM-DDTHH:mm` wall-clock value a `datetime-local` input expects.
 * Forms send these values back with their time zone, and the server converts them.
 */
export function toLocalDateTime(instant: Date | number | string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
