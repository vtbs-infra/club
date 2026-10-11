import rawRegions from './address-data/regions.json';

export interface AddressRegion {
  readonly code: string;
  readonly name: string;
  readonly children: readonly AddressRegion[];
}

interface RawRegion {
  readonly code: string;
  readonly name: string;
  readonly children?: readonly RawRegion[];
}

export interface ParsedAddress {
  readonly province: string;
  readonly city: string;
  readonly district: string;
  readonly detailedAddress: string;
}

export interface AddressRecognition {
  readonly recipientName: string;
  readonly phones: readonly string[];
  readonly postalCode: string;
  readonly userNote: string;
  readonly candidates: readonly ParsedAddress[];
}

const municipalities = new Set(['北京市', '天津市', '上海市', '重庆市']);
const leaf = (region: RawRegion): AddressRegion => ({ ...region, children: [] });

export const addressRegions: readonly AddressRegion[] = rawRegions.map((province) => ({
  code: province.code,
  name: province.name,
  children: municipalities.has(province.name)
    ? [
        {
          code: province.code,
          name: province.name,
          children: province.children.flatMap((city) => city.children.map(leaf)),
        },
      ]
    : province.children.flatMap((city) =>
        city.name.includes('直辖县级')
          ? city.children.map(leaf)
          : [
              {
                code: city.code,
                name: city.name,
                children: city.children
                  .filter((district) => district.code.length === 6 && district.name !== '市辖区')
                  .map(leaf),
              },
            ],
      ),
}));

export function isKnownRegion(
  value: Pick<ParsedAddress, 'province' | 'city' | 'district'>,
): boolean {
  if (!value.province) return !value.city && !value.district;
  const province = addressRegions.find((item) => item.name === value.province);
  if (!province) return false;
  if (!value.city) return !value.district;
  const city = province.children.find((item) => item.name === value.city);
  return Boolean(
    city && (!value.district || city.children.some((item) => item.name === value.district)),
  );
}

interface RegionToken {
  readonly name: string;
  readonly aliases: readonly string[];
}

function token(name: string): RegionToken {
  const short = name.replace(
    /(?:维吾尔自治区|壮族自治区|回族自治区|自治区|自治州|地区|省|市|区|县|盟|旗)$/u,
    '',
  );
  return { name, aliases: [...new Set([name, ...(short.length >= 2 ? [short] : [])])] };
}

const paths = addressRegions.flatMap((province) =>
  province.children.flatMap((city) =>
    (city.children.length ? city.children : [{ name: '' }]).map((district) =>
      [province.name, city.name, district.name].map(token),
    ),
  ),
);

const separators = /^[\s,，;；:：/]+/u;
const addressWords = /[省市区县路街巷道弄号栋幢楼室村镇乡组苑园座]/u;
const cleanEdges = (value: string) =>
  value.replace(/^[\s,，;；:：/]+|[\s,，;；:：/]+$/gu, '').trim();

interface RegionMatch extends ParsedAddress {
  readonly start: number;
  readonly end: number;
}

function matchRegions(text: string): RegionMatch[] {
  const matches = new Map<string, RegionMatch>();
  let earliestStart = Infinity;
  let longestEnd = -1;
  const positions = new Map<string, number[]>();
  const occurrences = (alias: string) => {
    let found = positions.get(alias);
    if (found) return found;
    found = [];
    if (alias) {
      for (let at = text.indexOf(alias); at >= 0; at = text.indexOf(alias, at + alias.length)) {
        found.push(at);
      }
    }
    positions.set(alias, found);
    return found;
  };
  for (const path of paths) {
    for (let first = 0; first < path.length; first += 1) {
      const firstToken = path[first]!;
      for (const alias of firstToken.aliases) {
        for (const start of occurrences(alias)) {
          if (start > earliestStart) continue;
          let end = start;
          let deepest = -1;
          let evidence = 0;
          let full = false;
          for (let level = first; level < path.length; level += 1) {
            const part = path[level]!;
            const from = end + (text.slice(end).match(separators)?.[0].length ?? 0);
            const matched = part.aliases.find((candidate) => {
              if (!candidate || !text.startsWith(candidate, from)) return false;
              // A city/district abbreviation inside a street name is not region evidence.
              return (
                candidate === part.name ||
                !/[路街巷道弄号栋幢楼室村镇乡苑园]/u.test(text[from + candidate.length] ?? '')
              );
            });
            if (!matched) continue;
            end = from + matched.length;
            deepest = level;
            evidence += 1;
            full ||= matched === part.name;
          }
          if (deepest < 0 || (!full && evidence < 2)) continue;
          if (start === earliestStart && end < longestEnd) continue;
          if (start < earliestStart || end > longestEnd) matches.clear();
          earliestStart = start;
          longestEnd = end;
          const match = {
            province: path[0]!.name,
            city: deepest >= 1 || municipalities.has(path[0]!.name) ? path[1]!.name : '',
            district: deepest >= 2 ? path[2]!.name : '',
            detailedAddress: '',
            start,
            end,
          };
          matches.set([match.province, match.city, match.district].join('/'), match);
        }
      }
    }
  }
  // Only consume a contiguous region prefix. Place names later in the street stay intact.
  return [...matches.values()];
}

export function recognizeAddress(input: string): AddressRecognition | null {
  if (!input.trim() || input.length > 2000) return null;
  // Normalize full-width ASCII without rewriting punctuation inside building/room details.
  let text = input
    .replace(/[！-～]/gu, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/gu, ' ');
  let recipientName = '';
  let postalCode = '';
  let userNote = '';
  const labels = [
    ...text.matchAll(
      /(收货人|收件人|联系人|姓名|手机号码|联系电话|手机号|手机|电话|所在地区|收货地址|收件地址|详细地址|地址|邮政编码|邮编|配送备注|备注)(?:\s*[:：]\s*|\s+)/gu,
    ),
  ];
  if (labels.filter((label) => /^(?:收货人|收件人|联系人|姓名)$/u.test(label[1]!)).length > 1)
    return null;
  const removed: { start: number; end: number }[] = [];
  for (const [index, label] of labels.entries()) {
    const start = label.index + label[0].length;
    const end = labels[index + 1]?.index ?? text.length;
    const value = cleanEdges(text.slice(start, end));
    removed.push({ start: label.index, end: start });
    if (
      /^(?:收货人|收件人|联系人|姓名)$/u.test(label[1]!) &&
      value &&
      value.length <= 100 &&
      !/\d{5,}|[\r\n]/u.test(value) &&
      (labels[index + 1] || !addressWords.test(value))
    ) {
      recipientName = value;
      removed.push({ start, end });
    } else if (/^(?:邮政编码|邮编)$/u.test(label[1]!)) {
      const match = text.slice(start).match(/^\d{6}(?!\d)/u);
      if (match) {
        postalCode = match[0];
        removed.push({ start, end: start + match[0].length });
      }
    } else if (/^(?:配送备注|备注)$/u.test(label[1]!) && value) {
      userNote = value;
      removed.push({ start, end });
    }
  }
  text = text
    .split('')
    .map((character, index) =>
      removed.some((span) => index >= span.start && index < span.end) ? ' ' : character,
    )
    .join('');

  const phones: string[] = [];
  text = text.replace(
    /(?<![\d*])(?:\+?86[ -]?)?1[3-9]\d(?:[ -]?\d){8}(?![\d*])|(?<!\d)0\d{2,3}[- ]\d{7,8}(?:[- ]\d{1,6})?(?!\d)/gu,
    (phone) => {
      const normalized = phone.startsWith('0')
        ? phone.replace(/ /gu, '-')
        : phone.replace(/[ -]/gu, '').replace(/^\+?86(?=1\d{10}$)/u, '');
      phones.push(normalized);
      return ' '.repeat(phone.length);
    },
  );
  // An anonymized number cannot be used for delivery, and is not part of the street.
  text = text.replace(/(?<!\d)1[3-9]\d[\d*＊]{8}(?!\d)/gu, (value) =>
    value.includes('*') || value.includes('＊') ? ' '.repeat(value.length) : value,
  );
  const matches = matchRegions(text);
  if (!matches.length && !phones.length && !recipientName) return null;
  const start = matches[0]?.start;
  const end = matches[0]?.end;
  let prefix = start === undefined ? '' : cleanEdges(text.slice(0, start));
  let detail = cleanEdges(text.slice(end ?? 0));
  if (
    phones.length > 1 &&
    matches.length &&
    matchRegions(detail).some((match) => match.city && match.district)
  )
    return null;
  if (
    !recipientName &&
    prefix &&
    prefix.length <= 100 &&
    !addressWords.test(prefix) &&
    !/[\d*]/u.test(prefix)
  ) {
    recipientName = prefix;
    prefix = '';
  }
  // Names without labels are accepted only as separate tokens at an address edge.
  if (!recipientName) {
    const name = detail.match(/(?:^|[\s,，;；])([\p{L}·]{2,20})\s*$/u);
    if (name && !addressWords.test(name[1]!)) {
      recipientName = name[1]!;
      detail = cleanEdges(detail.slice(0, name.index));
    }
  }
  const detailedAddress = [prefix, detail]
    .filter(Boolean)
    .join(' ')
    .replace(/[\r\n\t]+/gu, ' ')
    .trim();
  return {
    recipientName,
    phones: [...new Set(phones)],
    postalCode,
    userNote,
    candidates: matches.length
      ? matches.map(({ province, city, district }) => ({
          province,
          city,
          district,
          detailedAddress,
        }))
      : [{ province: '', city: '', district: '', detailedAddress }],
  };
}
