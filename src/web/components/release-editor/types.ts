import type { GiftFormField, GuardTier } from '../../api/client';

export interface EditableItem {
  description: string;
  name: string;
  quantity: number;
}

export interface EditablePackage {
  description: string;
  items: EditableItem[];
  name: string;
}

export interface EditableField {
  key: string;
  label: string;
  options: string[];
  required: boolean;
  type: GiftFormField['type'];
}

export const tierNames: Readonly<Record<GuardTier, string>> = {
  ADMIRAL: '提督',
  CAPTAIN: '舰长',
  GOVERNOR: '总督',
};
