import { dateTimeLocalToIso } from '../../lib/date-time';
import type { EditableField, EditablePackage } from './types';

export function releaseValidationMessage(input: {
  readonly claimDeadlineAt: string;
  readonly claimStartAt: string;
  readonly fields: readonly EditableField[];
  readonly packages: readonly EditablePackage[];
  readonly timeZone: string;
  readonly title: string;
}): string | null {
  if (!input.title.trim()) return '礼物名称不能只包含空格。';
  let claimStart: string;
  let claimDeadline: string;
  try {
    claimStart = dateTimeLocalToIso(input.claimStartAt, input.timeZone);
    claimDeadline = dateTimeLocalToIso(input.claimDeadlineAt, input.timeZone);
  } catch {
    return `领取时间在 ${input.timeZone} 时区中不存在或格式不正确。`;
  }
  if (Date.parse(claimDeadline) <= Date.parse(claimStart)) {
    return '领取截止时间必须晚于开始时间。';
  }
  const packageNames = input.packages.map((package_) => package_.name.trim());
  if (packageNames.some((name) => !name)) return '每个礼包都需要填写名称。';
  if (new Set(packageNames).size !== packageNames.length) return '礼包名称不能重复。';
  for (const package_ of input.packages) {
    if (package_.items.some((item) => !item.name.trim())) {
      return `礼包“${package_.name.trim()}”中有物品尚未填写名称。`;
    }
    if (
      package_.items.some(
        (item) => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999,
      )
    ) {
      return `礼包“${package_.name.trim()}”中的物品数量必须是 1 至 999 的整数。`;
    }
  }
  for (const field of input.fields) {
    const label = field.label.trim();
    if (!label) return '每个领取填写项都需要填写显示名称。';
    if (field.type !== 'SELECT' && field.type !== 'RADIO') continue;
    const options = field.options.map((option) => option.trim());
    if (options.length > 30) return `填写项“${label}”最多可以设置 30 个选项。`;
    if (options.length === 0 || options.some((option) => !option)) {
      return `填写项“${label}”的可选项不能为空。`;
    }
    if (options.some((option) => option.length > 120)) {
      return `填写项“${label}”的单个选项不能超过 120 个字符。`;
    }
    if (new Set(options).size !== options.length) {
      return `填写项“${label}”中存在重复选项。`;
    }
  }
  return null;
}
