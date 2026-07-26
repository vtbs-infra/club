import { AppError } from '../../../shared/errors/app-error.js';

export const FULFILLMENT_CSV_VERSION = '1';

export const IMPORT_COLUMNS = [
  'format_version',
  'claim_number',
  'shipment_key',
  'carrier_code',
  'tracking_number',
  'tracking_url',
  'claim_entitlement_ids',
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export function csvCell(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeCsv(
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[],
): string {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) {
    throw new AppError('SHIPMENT_CSV_INVALID', 'CSV contains an unterminated quoted value.', 400);
  }
  row.push(cell.replace(/\r$/, ''));
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

export function parseImportCsv(text: string): {
  readonly headerValid: boolean;
  readonly rows: readonly {
    readonly rowNumber: number;
    readonly validColumnCount: boolean;
    readonly values: Readonly<Record<ImportColumn, string>>;
  }[];
} {
  const rows = parseCsv(text);
  const header = rows[0]?.map((value) => value.trim().toLowerCase()) ?? [];
  const headerValid =
    header.length === IMPORT_COLUMNS.length &&
    IMPORT_COLUMNS.every((column, index) => header[index] === column);
  if (!headerValid) return { headerValid, rows: [] };
  return {
    headerValid,
    rows: rows.slice(1).map((values, index) => ({
      rowNumber: index + 2,
      validColumnCount: values.length === IMPORT_COLUMNS.length,
      values: Object.fromEntries(
        IMPORT_COLUMNS.map((column, columnIndex) => [column, values[columnIndex]?.trim() ?? '']),
      ) as Record<ImportColumn, string>,
    })),
  };
}

export function validateTrackingUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim() || null;
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    return url.toString();
  } catch {
    throw new AppError(
      'SHIPMENT_TRACKING_URL_INVALID',
      'Tracking URL must be an HTTP or HTTPS URL.',
      400,
    );
  }
}
