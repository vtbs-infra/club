import type { Dispatch, SetStateAction } from 'react';

import type { GuardTier } from '../../api/client';
import { tierNames, type EditablePackage } from './types';

interface TierRulesSectionProps {
  readonly editable: boolean;
  readonly packages: EditablePackage[];
  readonly setTierPackageIndexes: Dispatch<SetStateAction<Record<GuardTier, number>>>;
  readonly tierPackageIndexes: Record<GuardTier, number>;
}

export function TierRulesSection({
  editable,
  packages,
  setTierPackageIndexes,
  tierPackageIndexes,
}: TierRulesSectionProps) {
  return (
    <section className="panel editor-section">
      <div className="editor-section-title">
        <span>4</span>
        <div>
          <h2>等级规则</h2>
          <p>为舰长、提督和总督指定对应礼包。</p>
        </div>
      </div>
      {packages.length === 0 ? (
        <p className="quiet-line">请先创建至少一个礼包。</p>
      ) : (
        <div className="tier-mapping">
          {(['CAPTAIN', 'ADMIRAL', 'GOVERNOR'] as const).map((tier) => (
            <label key={tier}>
              <strong>{tierNames[tier]}</strong>
              <span>获得</span>
              <select
                disabled={!editable}
                onChange={(event) =>
                  setTierPackageIndexes((current) => ({
                    ...current,
                    [tier]: Number(event.target.value),
                  }))
                }
                value={Math.min(tierPackageIndexes[tier], packages.length - 1)}
              >
                {packages.map((package_, index) => (
                  <option key={index} value={index}>
                    {package_.name || `礼包 ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
