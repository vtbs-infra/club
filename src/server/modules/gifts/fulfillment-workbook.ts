import ExcelJS from 'exceljs';

import type { AddressPayload } from '../addresses/address-domain.js';

export interface FulfillmentWorkbookField {
  readonly key: string;
  readonly label: string;
}

export interface FulfillmentWorkbookPackage {
  readonly items: readonly {
    readonly name: string;
    readonly quantity: number;
  }[];
  readonly name: string;
}

export interface FulfillmentWorkbookRow {
  readonly address: AddressPayload;
  readonly biliDisplayName: string;
  readonly biliUid: string;
  readonly optionValues: Readonly<Record<string, boolean | string>>;
  readonly orderNumber: string;
  readonly packages: readonly FulfillmentWorkbookPackage[];
  readonly submittedAt: Date;
  readonly tier: 'ADMIRAL' | 'CAPTAIN' | 'GOVERNOR';
}

export interface FulfillmentWorkbookInput {
  readonly creatorDisplayName: string;
  readonly eligibilityMonth: string;
  readonly fields: readonly FulfillmentWorkbookField[];
  readonly generatedAt: Date;
  readonly releaseTitle: string;
  readonly rows: readonly FulfillmentWorkbookRow[];
  readonly timezone: string;
}

const FIXED_HEADERS = [
  '礼物单号',
  '收件人',
  '手机号',
  '国家/地区',
  '省',
  '市',
  '区/县',
  '详细地址',
  '完整地址',
  '邮编',
  '地址备注',
  'B站 UID',
  'B站昵称',
  '大航海等级',
  '礼包及礼物内容',
  '提交时间',
  '状态',
] as const;

const FIXED_WIDTHS = [24, 16, 18, 14, 14, 14, 14, 36, 52, 12, 24, 20, 24, 12, 44, 22, 12] as const;

const TIER_LABELS: Readonly<Record<FulfillmentWorkbookRow['tier'], string>> = {
  ADMIRAL: '提督',
  CAPTAIN: '舰长',
  GOVERNOR: '总督',
};

export function safeSpreadsheetText(value: string | null | undefined): string {
  const cleaned = Array.from(value ?? '', (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
      ? ' '
      : character;
  }).join('');
  return /^[=+\-@]/.test(cleaned) ? `'${cleaned}` : cleaned;
}

function formatDate(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: timezone,
  }).format(value);
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

function packageSummary(packages: readonly FulfillmentWorkbookPackage[]): string {
  return packages
    .map((package_) => {
      const items = package_.items
        .map((item) => `${safeSpreadsheetText(item.name)} × ${item.quantity}`)
        .join('、');
      return items
        ? `${safeSpreadsheetText(package_.name)}：${items}`
        : safeSpreadsheetText(package_.name);
    })
    .join('；');
}

function optionText(value: boolean | string | undefined): string {
  if (typeof value === 'boolean') return value ? '是' : '否';
  return safeSpreadsheetText(value);
}

export async function buildFulfillmentWorkbook(input: FulfillmentWorkbookInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Club';
  workbook.created = input.generatedAt;
  workbook.modified = input.generatedAt;
  workbook.subject = '待发货礼物单履约清单';
  workbook.title = safeSpreadsheetText(
    `${input.creatorDisplayName} ${input.releaseTitle} 待发货清单`,
  );

  const worksheet = workbook.addWorksheet('待发货清单', {
    properties: { defaultRowHeight: 20 },
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const headers = [...FIXED_HEADERS, ...input.fields.map((field) => field.label)];
  const widths = [...FIXED_WIDTHS, ...input.fields.map(() => 24)];
  worksheet.addRow(headers.map((header) => safeSpreadsheetText(header)));
  const header = worksheet.getRow(1);
  header.height = 26;
  header.eachCell((cell) => {
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = { fgColor: { argb: 'FFE8EEF8' }, pattern: 'solid', type: 'pattern' };
    cell.font = { bold: true, color: { argb: 'FF24324A' } };
  });

  for (const item of input.rows) {
    const address = item.address;
    const row = worksheet.addRow([
      safeSpreadsheetText(item.orderNumber),
      safeSpreadsheetText(address.recipientName),
      safeSpreadsheetText(address.phone),
      safeSpreadsheetText(address.countryRegion),
      safeSpreadsheetText(address.province),
      safeSpreadsheetText(address.city),
      safeSpreadsheetText(address.district),
      safeSpreadsheetText(address.detailedAddress),
      safeSpreadsheetText(fullAddress(address)),
      safeSpreadsheetText(address.postalCode),
      safeSpreadsheetText(address.userNote),
      safeSpreadsheetText(item.biliUid),
      safeSpreadsheetText(item.biliDisplayName),
      TIER_LABELS[item.tier],
      packageSummary(item.packages),
      formatDate(item.submittedAt, input.timezone),
      '待发货',
      ...input.fields.map((field) => optionText(item.optionValues[field.key])),
    ]);
    row.alignment = { vertical: 'top', wrapText: true };
    row.eachCell((cell) => {
      cell.border = { bottom: { color: { argb: 'FFDDE3EC' }, style: 'hair' } };
    });
    for (const column of [1, 3, 10, 12]) row.getCell(column).numFmt = '@';
  }

  for (const [index, width] of widths.entries()) worksheet.getColumn(index + 1).width = width;
  worksheet.autoFilter = {
    from: { column: 1, row: 1 },
    to: { column: headers.length, row: 1 },
  };

  const information = workbook.addWorksheet('导出说明');
  information.columns = [{ width: 18 }, { width: 72 }];
  const generatedAt = formatDate(input.generatedAt, input.timezone);
  const details = [
    ['主播', input.creatorDisplayName],
    ['礼物发布', input.releaseTitle],
    ['资格月份', input.eligibilityMonth.slice(0, 7)],
    ['导出时间', generatedAt],
    ['记录数', String(input.rows.length)],
    ['包含状态', '待发货'],
    [
      '使用提示',
      '本文件包含用户领取时冻结的敏感收货信息，仅用于本次礼物履约。导出不会改变礼物单状态。',
    ],
  ];
  for (const [label, value] of details) {
    const row = information.addRow([safeSpreadsheetText(label), safeSpreadsheetText(value)]);
    row.getCell(1).font = { bold: true };
    row.alignment = { vertical: 'top', wrapText: true };
  }

  const content = await workbook.xlsx.writeBuffer();
  return Buffer.from(content);
}
