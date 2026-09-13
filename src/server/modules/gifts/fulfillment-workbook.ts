import writeExcelFile, { type Column } from 'write-excel-file/node';

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
  readonly fields: readonly FulfillmentWorkbookField[];
  readonly rows: readonly FulfillmentWorkbookRow[];
  readonly timezone: string;
}

const TIER_LABELS: Readonly<Record<FulfillmentWorkbookRow['tier'], string>> = {
  ADMIRAL: '提督',
  CAPTAIN: '舰长',
  GOVERNOR: '总督',
};

function textColumn(
  header: string,
  width: number,
  value: (row: FulfillmentWorkbookRow) => string,
): Column<FulfillmentWorkbookRow> {
  return {
    header: { type: String, value: header, fontWeight: 'bold' },
    width,
    // Explicit text cells preserve identifiers and formula-like user content without prefixes.
    cell: (row) => ({ type: String, value: value(row) }),
  };
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
      const items = package_.items.map((item) => `${item.name} × ${item.quantity}`).join('、');
      return items ? `${package_.name}：${items}` : package_.name;
    })
    .join('；');
}

function optionText(value: boolean | string | undefined): string {
  if (typeof value === 'boolean') return value ? '是' : '否';
  return value ?? '';
}

export async function buildFulfillmentWorkbook(input: FulfillmentWorkbookInput): Promise<Buffer> {
  const dateFormat = new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: input.timezone,
  });
  const columns = [
    textColumn('礼物单号', 24, (row) => row.orderNumber),
    textColumn('收件人', 16, (row) => row.address.recipientName),
    textColumn('手机号', 18, (row) => row.address.phone),
    textColumn('国家/地区', 14, (row) => row.address.countryRegion),
    textColumn('省', 14, (row) => row.address.province),
    textColumn('市', 14, (row) => row.address.city),
    textColumn('区/县', 14, (row) => row.address.district),
    textColumn('详细地址', 36, (row) => row.address.detailedAddress),
    textColumn('完整地址', 52, (row) => fullAddress(row.address)),
    textColumn('邮编', 12, (row) => row.address.postalCode),
    textColumn('地址备注', 24, (row) => row.address.userNote),
    textColumn('B站 UID', 20, (row) => row.biliUid),
    textColumn('B站昵称', 24, (row) => row.biliDisplayName),
    textColumn('大航海等级', 12, (row) => TIER_LABELS[row.tier]),
    textColumn('礼包及礼物内容', 44, (row) => packageSummary(row.packages)),
    textColumn('提交时间', 22, (row) => dateFormat.format(row.submittedAt)),
    textColumn('状态', 12, () => '待发货'),
    ...input.fields.map((field) =>
      textColumn(field.label, 24, (row) => optionText(row.optionValues[field.key])),
    ),
  ];
  return writeExcelFile(Array.from(input.rows), { sheet: '待发货清单', columns }).toBuffer();
}
