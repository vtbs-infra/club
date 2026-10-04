import { areaList } from '@vant/area-data';

import type { AddressPayloadContract } from '../../shared/contracts/addresses';
import { ADDRESS_FIELDS, ADDRESS_TEXT_LIMIT, EMPTY_ADDRESS } from './address-fields';

export interface ParsedAddress {
  readonly payload: AddressPayloadContract;
  readonly warnings: readonly string[];
  readonly complete: boolean;
  readonly recognized: boolean;
}

interface Region {
  readonly province: string;
  readonly city: string;
  readonly district: string;
  readonly districtOptional?: boolean;
}

interface RegionMatch extends Region {
  readonly start: number;
  readonly end: number;
  readonly score: number;
}

const provinces = areaList.province_list;
const cities = areaList.city_list;
const counties = areaList.county_list;
const mainland = (code: string) => Number(code.slice(0, 2)) < 71;
// The source also lists towns, streets and industrial parks under county_list.
const isCounty = (name: string) => /[区县市旗]$/.test(name);
const citiesWithCounties = new Set(
  Object.entries(counties)
    .filter(([, name]) => isCounty(name))
    .map(([code]) => code.slice(0, 4)),
);
const provinceAliases: Readonly<Record<string, string>> = {
  内蒙古自治区: '内蒙古',
  广西壮族自治区: '广西',
  西藏自治区: '西藏',
  宁夏回族自治区: '宁夏',
  新疆维吾尔自治区: '新疆',
};

function aliases(name: string, province = false): string[] {
  const short = provinceAliases[name] ?? name.replace(province ? /[省市]$/ : /市$/, '');
  return short !== name && short.length >= 2 ? [name, short] : [name];
}

const regions: Region[] = [];
for (const [code, city] of Object.entries(cities)) {
  if (!mainland(code) || /直辖/.test(city)) continue;
  const province = provinces[`${code.slice(0, 2)}0000`];
  if (province)
    regions.push({
      province,
      city,
      district: '',
      districtOptional: !citiesWithCounties.has(code.slice(0, 4)),
    });
}
for (const [code, district] of Object.entries(counties)) {
  if (!mainland(code)) continue;
  if (!isCounty(district)) continue;
  const province = provinces[`${code.slice(0, 2)}0000`];
  const parent = cities[`${code.slice(0, 4)}00`];
  if (!province || !parent) continue;
  // Directly administered county-level cities have no real intermediate city.
  regions.push(
    /直辖/.test(parent)
      ? { province, city: district, district: '', districtOptional: true }
      : { province, city: parent, district },
  );
}

const separators = /^[\s,，;；、|]+/;
const trimSeparators = (value: string) => value.replace(/^[\s,，;；、|]+|[\s,，;；、|]+$/g, '');

function consume(text: string, position: number, names: readonly string[]): number | null {
  const start = position + (text.slice(position).match(separators)?.[0].length ?? 0);
  for (const name of names) {
    if (text.startsWith(name, start)) {
      const next = text.slice(start + name.length);
      // Do not interpret "北京路" as Beijing or "吉林市" as a province abbreviation.
      if (/^(?:路|街|大道|省|市|区|县)/.test(next) && !/[省市区县旗]$/.test(name)) continue;
      return start + name.length;
    }
  }
  return null;
}

function matchRegions(text: string): RegionMatch[] {
  const matches: RegionMatch[] = [];
  for (const region of regions) {
    const provinceNames = aliases(region.province, true);
    const cityNames = aliases(region.city);
    const starts = new Set<number>();
    for (const name of [
      ...provinceNames,
      ...cityNames,
      ...(region.district ? [region.district] : []),
    ]) {
      let position = text.indexOf(name);
      while (position !== -1) {
        starts.add(position);
        position = text.indexOf(name, position + name.length);
      }
    }
    for (const start of starts) {
      let end = start;
      let score = 0;
      const provinceEnd = consume(text, end, provinceNames);
      if (provinceEnd !== null) {
        end = provinceEnd;
        score += 4;
      }
      const cityEnd = consume(text, end, cityNames);
      if (cityEnd !== null) {
        end = cityEnd;
        score += 4;
      }
      const districtEnd = region.district ? consume(text, end, [region.district]) : null;
      if (districtEnd !== null) {
        end = districtEnd;
        score += 4;
      }
      const cityKnown =
        cityEnd !== null || (provinceEnd !== null && region.province === region.city);
      const districtKnown =
        districtEnd !== null || (cityEnd !== null && region.city === region.district);
      if (!score || (!cityKnown && !districtKnown)) continue;
      if (region.district && !districtKnown) continue;
      matches.push({ ...region, start, end, score });
    }
  }
  return matches;
}

function parseRegion(
  text: string,
  warnings: string[],
): { region?: Region; before: string; detail: string; blocked?: boolean } {
  const matches = matchRegions(text);
  if (matches.length === 0) {
    warnings.push('未能确定省市区，请对照原文手动填写；首版仅识别中国大陆地址。');
    return { before: '', detail: '' };
  }
  // An independently recognizable second address must never be silently appended as detail.
  const firstStart = Math.min(...matches.map((match) => match.start));
  const first = matches.filter((match) => match.start === firstStart);
  const maximumEnd = Math.max(...first.map((match) => match.end));
  if (matches.some((match) => match.start > maximumEnd && match.score >= 8)) {
    warnings.push('检测到多段地址，请每次只粘贴一个收货地址。');
    return { before: '', detail: '', blocked: true };
  }
  const score = Math.max(...first.map((match) => match.score));
  const strongest = first.filter((match) => match.score === score);
  const end = Math.max(...strongest.map((match) => match.end));
  const best = strongest.filter((match) => match.end === end);
  const unique = new Map(
    best.map((match) => [JSON.stringify([match.province, match.city, match.district]), match]),
  );
  if (unique.size !== 1) {
    warnings.push('省市区存在同名或歧义，请补充上级地区后重试，或手动填写。');
    return { before: '', detail: '' };
  }
  const region = [...unique.values()][0]!;
  const before = trimSeparators(text.slice(0, region.start).replace(/中国(?:大陆)?\s*$/, ''));
  if (
    /[省市区县]/.test(before) ||
    Object.values(provinces).some((name) =>
      aliases(name, true).some((alias) => before.includes(alias)),
    )
  ) {
    warnings.push('地区上下级关系可能不一致，请核对原文后手动填写。');
    return { before: '', detail: '', blocked: true };
  }
  if (!region.district && !region.districtOptional)
    warnings.push('未识别到区 / 县，请核对并按需补充；街道和门牌号已保留在详细地址。');
  return { region, before, detail: trimSeparators(text.slice(region.end)) };
}

type LabelField =
  | 'recipientName'
  | 'phone'
  | 'fullAddress'
  | 'region'
  | 'detailedAddress'
  | 'postalCode'
  | 'userNote';
const labelPattern =
  /(收货人|收件人|联系人|姓名|联系电话|手机号码|手机号|手机|电话|收货地址|所在地区|详细地址|地区|地址|邮政编码|邮编|配送备注|备注)\s*[:：]\s*/g;

function labelField(label: string): LabelField {
  if (/人|姓名/.test(label)) return 'recipientName';
  if (/电话|手机/.test(label)) return 'phone';
  if (/邮/.test(label)) return 'postalCode';
  if (/备注/.test(label)) return 'userNote';
  if (label === '所在地区' || label === '地区') return 'region';
  if (label === '详细地址') return 'detailedAddress';
  return 'fullAddress';
}

const addressSources = ['unstructured', 'fullAddress', 'region', 'detailedAddress'] as const;
type PhoneSource = (typeof addressSources)[number] | 'phone';

interface PhoneMatch {
  readonly source: PhoneSource;
  readonly start: number;
  readonly end: number;
  readonly value: string;
  readonly masked: boolean;
}

function matchPhones(source: PhoneSource, text: string): PhoneMatch[] {
  const candidates = [
    ...[...text.matchAll(/(?<!\d)1[3-9][\d*＊xX•·]{9}(?!\d)/g)]
      .filter((match) => /[*＊xX•·]/.test(match[0]))
      .map((match) => ({ match, masked: true })),
    ...[
      ...text.matchAll(
        /(?<![\d])(?:\+?86[ -]?)?1[3-9]\d[ -]?\d{4}[ -]?\d{4}(?!\d)|(?<!\d)(?:\(0\d{2,3}\)|0\d{2,3})[- ]\d{7,8}(?:[-转]\d{1,6})?(?!\d)/g,
      ),
    ].map((match) => ({ match, masked: false })),
  ];
  return candidates
    .filter(
      ({ match }) =>
        !/^\s*(?:号|室|栋|幢|单元|楼|层)/.test(text.slice(match.index + match[0].length)),
    )
    .map(({ match, masked }) => ({
      source,
      start: match.index,
      end: match.index + match[0].length,
      value: match[0],
      masked,
    }));
}

function removePhoneMatches(text: string, matches: readonly PhoneMatch[]): string {
  // Work backwards within the original source so duplicate digits and earlier offsets stay intact.
  for (const match of [...matches].sort((left, right) => right.start - left.start)) {
    text = text.slice(0, match.start) + ',' + text.slice(match.end);
  }
  return text;
}

export function parseAddress(raw: string): ParsedAddress {
  const payload = { ...EMPTY_ADDRESS, countryRegion: '' };
  const warnings: string[] = [];
  let blocked = false;
  const result = (): ParsedAddress => ({
    payload,
    warnings: [...new Set(warnings)],
    complete: warnings.length === 0,
    recognized:
      !blocked &&
      ADDRESS_FIELDS.some(({ key }) => key !== 'countryRegion' && Boolean(payload[key])),
  });
  if (!raw.trim() || raw.length > ADDRESS_TEXT_LIMIT) {
    warnings.push(
      raw.trim()
        ? `整条地址不能超过 ${ADDRESS_TEXT_LIMIT} 个字符，请只粘贴一个地址。`
        : '请先粘贴收货地址。',
    );
    return result();
  }
  // Normalize digit/punctuation widths only; do not rewrite building or apartment text.
  const text = raw
    .replace(/[０-９＋（）－：]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
    .replace(/\r\n?/g, '\n');
  const labels = [...text.matchAll(labelPattern)];
  const labeled: Partial<Record<LabelField, string[]>> = {};
  const rest = labels.length ? text.slice(0, labels[0]!.index) : text;
  for (let index = 0; index < labels.length; index += 1) {
    const match = labels[index]!;
    const field = labelField(match[1]!);
    const value = trimSeparators(
      text.slice(match.index + match[0].length, labels[index + 1]?.index ?? text.length),
    );
    (labeled[field] ??= []).push(value);
  }
  for (const field of ['recipientName', 'phone', 'postalCode', 'userNote'] as const) {
    const values = labeled[field];
    if (!values) continue;
    if (values.length > 1) {
      warnings.push('检测到重复的收件信息，请每次只粘贴一个地址。');
      blocked = true;
      return result();
    }
    payload[field] = values[0]!;
  }
  if (
    (['fullAddress', 'region', 'detailedAddress'] as const).some(
      (field) => (labeled[field]?.length ?? 0) > 1,
    ) ||
    (labeled.fullAddress && (labeled.region || labeled.detailedAddress))
  ) {
    warnings.push('检测到重复或冲突的地址标签，请只保留一个收货地址，或一组所在地区和详细地址。');
    blocked = true;
    return result();
  }
  if (payload.postalCode && !/^\d{6}$/.test(payload.postalCode)) {
    payload.postalCode = '';
    warnings.push('邮编格式不明确，已留空，请核对。');
  }
  const phoneSources: Record<PhoneSource, string> = {
    phone: payload.phone,
    unstructured: rest,
    fullAddress: labeled.fullAddress?.[0] ?? '',
    region: labeled.region?.[0] ?? '',
    detailedAddress: labeled.detailedAddress?.[0] ?? '',
  };
  // An explicit phone field is authoritative, including when it is empty or invalid.
  // Otherwise scan each source separately: a number must never span two labeled fields.
  const sources: readonly PhoneSource[] = labeled.phone ? ['phone'] : addressSources;
  const matches = sources.flatMap((source) => matchPhones(source, phoneSources[source]));
  const masked = matches.some((match) => match.masked);
  const phones = matches.filter((match) => !match.masked);
  if (masked || phones.length > 1) {
    payload.phone = '';
    warnings.push(
      masked
        ? '手机号含有隐藏字符，无法还原，请填写完整联系电话。'
        : '检测到多个电话号码，请确认一个有效联系电话。',
    );
  } else if (phones.length === 1) {
    const match = phones[0]!;
    const phone = match.value;
    const afterPhone = phoneSources[match.source].slice(match.end);
    if (/转/.test(phone) || /^\s*(?:转|分机|ext\.?|#|-)\s*\d+/i.test(afterPhone)) {
      payload.phone = '';
      warnings.push('联系电话包含分机，请核对可直接拨打的完整号码后手动填写。');
    } else {
      payload.phone = /^\(?0/.test(phone) ? phone : phone.replace(/[ -]/g, '');
    }
  } else if (payload.phone) {
    payload.phone = '';
    warnings.push('未能识别联系电话，请手动填写有效号码。');
  }
  // Remove only actual matches from their own source, never by looking up their digits again.
  // Matches from a labeled phone field cannot modify any address text.
  for (const source of addressSources) {
    phoneSources[source] = removePhoneMatches(
      phoneSources[source],
      matches.filter((match) => match.source === source),
    );
  }
  const regionText = trimSeparators(
    addressSources.map((source) => phoneSources[source]).join(' '),
  ).replace(/^中国(?:大陆)?[ ,，]*/, '');
  const parsed = parseRegion(regionText, warnings);
  blocked = Boolean(parsed.blocked);
  if (parsed.region) {
    payload.countryRegion = '中国大陆';
    payload.province = parsed.region.province;
    payload.city = parsed.region.city;
    payload.district = parsed.region.district;
    payload.detailedAddress = parsed.detail;
    if (!payload.recipientName) {
      const candidate = parsed.before;
      if (candidate && /^[\p{L}·・.' -]{1,100}$/u.test(candidate))
        payload.recipientName = candidate;
    }
  }
  // Unlabeled trailing words cannot reliably distinguish names from delivery instructions.
  // Keep them in detail and require preview/manual completion instead of guessing a recipient.
  if (!payload.recipientName && parsed.region) {
    const parts = payload.detailedAddress
      .split(/[,，;；\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      warnings.push('无法确定地址尾部文字是否为收件人，已保留在详细地址；请核对并补充收件人。');
    }
  }
  for (const { key, label, maxLength, required } of ADDRESS_FIELDS) {
    if (payload[key].length > maxLength) {
      payload[key] = '';
      warnings.push(`${label}超过长度限制，请对照原文手动填写，不会自动截断。`);
    }
    if (required && !payload[key]) warnings.push(`请补充${label}。`);
  }
  return result();
}
