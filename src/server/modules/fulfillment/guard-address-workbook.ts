import ExcelJS from '@excel.js/exceljs';

import type { AddressPayload } from '../addresses/address-domain.js';

export type GuardTier = 'CAPTAIN' | 'ADMIRAL' | 'GOVERNOR';

export interface GuardAddressWorkbookRow {
  readonly address: AddressPayload;
  readonly biliUid: string;
  readonly claimNumber: string;
  readonly claimStatus: string;
  readonly displayName: string;
  readonly tier: GuardTier;
}

export interface GuardAddressWorkbookInput {
  readonly creatorDisplayName: string;
  readonly generatedAt: Date;
  readonly periodStart: string;
  readonly rows: readonly GuardAddressWorkbookRow[];
  readonly timezone: string;
}

const HEADERS = [
  'UID',
  '昵称',
  '等级',
  '收件人',
  '手机号',
  '国家/地区',
  '省',
  '市',
  '区/县',
  '详细地址',
  '邮编',
  '完整地址',
  '地址备注',
  '领取编号',
  '领取状态',
] as const;

const COLUMN_WIDTHS = [20, 24, 12, 16, 18, 14, 14, 14, 14, 36, 12, 52, 24, 24, 14] as const;

const TIER_LABELS: Readonly<Record<GuardTier, string>> = {
  ADMIRAL: '提督',
  CAPTAIN: '舰长',
  GOVERNOR: '总督',
};

const TIER_FILLS: Readonly<Record<GuardTier, string>> = {
  ADMIRAL: 'FFD9D2E9',
  CAPTAIN: 'FFDDEBF7',
  GOVERNOR: 'FFFFE699',
};

function safeSpreadsheetText(value: string | null | undefined): string {
  const text = Array.from(value ?? '', (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
      ? ' '
      : character;
  }).join('');
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function fullAddress(address: AddressPayload): string {
  return [
    address.countryRegion,
    address.province,
    address.city,
    address.district,
    address.detailedAddress,
    address.postalCode,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

function formatGeneratedAt(input: GuardAddressWorkbookInput): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: input.timezone,
  }).format(input.generatedAt);
}

export async function buildGuardAddressWorkbook(input: GuardAddressWorkbookInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Club';
  workbook.created = input.generatedAt;
  workbook.modified = input.generatedAt;
  workbook.subject = '当月舰长冻结收货地址';
  workbook.title = `${input.creatorDisplayName} ${input.periodStart.slice(0, 7)} 当月舰长收货名单`;

  const worksheet = workbook.addWorksheet('当月舰长', {
    pageSetup: {
      fitToPage: true,
      fitToWidth: 1,
      orientation: 'landscape',
      paperSize: 9,
    },
    properties: { defaultRowHeight: 20 },
    views: [{ state: 'frozen', ySplit: 4 }],
  });
  worksheet.mergeCells(1, 1, 1, HEADERS.length);
  worksheet.getCell('A1').value =
    `${safeSpreadsheetText(input.creatorDisplayName)} ${input.periodStart.slice(0, 7)} 当月舰长收货名单`;
  worksheet.getCell('A1').font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 16 };
  worksheet.getCell('A1').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF345995' },
  };
  worksheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(1).height = 30;

  worksheet.mergeCells(2, 1, 2, HEADERS.length);
  worksheet.getCell('A2').value =
    `月份：${input.periodStart.slice(0, 7)} | 导出时间：${formatGeneratedAt(input)} | 记录数：${input.rows.length}`;
  worksheet.getCell('A2').font = { color: { argb: 'FF3E4C59' }, size: 10 };
  worksheet.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle' };

  worksheet.mergeCells(3, 1, 3, HEADERS.length);
  worksheet.getCell('A3').value =
    '地址为用户领取礼物时冻结的地址快照，包含敏感个人信息；请仅用于本期履约并妥善保管。';
  worksheet.getCell('A3').font = { bold: true, color: { argb: 'FF9C5700' }, size: 10 };
  worksheet.getCell('A3').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFF2CC' },
  };
  worksheet.getCell('A3').alignment = { horizontal: 'left', vertical: 'middle' };

  const headerRow = worksheet.getRow(4);
  headerRow.values = [...HEADERS];
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      bottom: { color: { argb: 'FFB4C6E7' }, style: 'thin' },
      left: { color: { argb: 'FFB4C6E7' }, style: 'thin' },
      right: { color: { argb: 'FFB4C6E7' }, style: 'thin' },
      top: { color: { argb: 'FFB4C6E7' }, style: 'thin' },
    };
  });

  for (const [index, item] of input.rows.entries()) {
    const address = item.address;
    const row = worksheet.addRow([
      safeSpreadsheetText(item.biliUid),
      safeSpreadsheetText(item.displayName),
      TIER_LABELS[item.tier],
      safeSpreadsheetText(address.recipientName),
      safeSpreadsheetText(address.phone),
      safeSpreadsheetText(address.countryRegion),
      safeSpreadsheetText(address.province),
      safeSpreadsheetText(address.city),
      safeSpreadsheetText(address.district),
      safeSpreadsheetText(address.detailedAddress),
      safeSpreadsheetText(address.postalCode),
      safeSpreadsheetText(fullAddress(address)),
      safeSpreadsheetText(address.userNote),
      safeSpreadsheetText(item.claimNumber),
      safeSpreadsheetText(item.claimStatus),
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    row.height = 34;
    row.eachCell((cell) => {
      cell.border = {
        bottom: { color: { argb: 'FFD9E2F3' }, style: 'hair' },
      };
      if (index % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FC' } };
      }
    });
    row.getCell(1).numFmt = '@';
    row.getCell(5).numFmt = '@';
    row.getCell(11).numFmt = '@';
    row.getCell(3).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: TIER_FILLS[item.tier] },
    };
    row.getCell(3).font = { bold: true };
    row.getCell(3).alignment = { horizontal: 'center', vertical: 'top' };
  }

  if (input.rows.length === 0) {
    worksheet.mergeCells(5, 1, 5, HEADERS.length);
    worksheet.getCell('A5').value = '本月暂无已领取且包含有效冻结地址的舰长记录。';
    worksheet.getCell('A5').font = { color: { argb: 'FF667085' }, italic: true };
    worksheet.getCell('A5').alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(5).height = 32;
  }

  for (const [index, width] of COLUMN_WIDTHS.entries()) {
    worksheet.getColumn(index + 1).width = width;
  }
  worksheet.autoFilter = `A4:${worksheet.getColumn(HEADERS.length).letter}4`;
  worksheet.pageSetup.printTitlesRow = '1:4';
  worksheet.pageSetup.margins = {
    bottom: 0.5,
    footer: 0.2,
    header: 0.2,
    left: 0.25,
    right: 0.25,
    top: 0.5,
  };

  const content = await workbook.xlsx.writeBuffer();
  return Buffer.from(content);
}
