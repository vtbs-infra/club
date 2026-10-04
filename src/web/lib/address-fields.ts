import type { AddressPayloadContract } from '../../shared/contracts/addresses';

export const ADDRESS_TEXT_LIMIT = 2000;

export const EMPTY_ADDRESS: AddressPayloadContract = {
  city: '',
  countryRegion: '中国大陆',
  detailedAddress: '',
  district: '',
  phone: '',
  postalCode: '',
  province: '',
  recipientName: '',
  userNote: '',
};

export const ADDRESS_FIELDS: readonly {
  readonly key: keyof AddressPayloadContract;
  readonly label: string;
  readonly maxLength: number;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly wide?: boolean;
}[] = [
  { key: 'recipientName', label: '收件人', maxLength: 100, required: true },
  { key: 'phone', label: '手机号码', maxLength: 40, required: true },
  { key: 'countryRegion', label: '国家或地区', maxLength: 100, required: true },
  { key: 'province', label: '省 / 直辖市', maxLength: 100, required: true },
  { key: 'city', label: '城市', maxLength: 100, required: true },
  { key: 'district', label: '区 / 县', maxLength: 100 },
  {
    key: 'detailedAddress',
    label: '详细地址',
    maxLength: 500,
    placeholder: '街道、门牌号、楼栋及房间号',
    required: true,
    wide: true,
  },
  { key: 'postalCode', label: '邮政编码', maxLength: 20 },
  {
    key: 'userNote',
    label: '配送备注',
    maxLength: 500,
    placeholder: '选填，仅在发货需要时使用',
    wide: true,
  },
];

export function hasAddressContent(payload: AddressPayloadContract): boolean {
  return ADDRESS_FIELDS.some(({ key }) => payload[key].trim() !== EMPTY_ADDRESS[key]);
}
