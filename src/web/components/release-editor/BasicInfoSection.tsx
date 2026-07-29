import type { ReleaseInput } from '../../api/client';

interface BasicInfoSectionProps {
  readonly claimDeadlineAt: string;
  readonly claimStartAt: string;
  readonly description: string;
  readonly editable: boolean;
  readonly eligibilityMonth: string;
  readonly fulfillmentMode: ReleaseInput['fulfillmentMode'];
  readonly onClaimDeadlineAtChange: (value: string) => void;
  readonly onClaimStartAtChange: (value: string) => void;
  readonly onDescriptionChange: (value: string) => void;
  readonly onEligibilityMonthChange: (value: string) => void;
  readonly onFulfillmentModeChange: (value: ReleaseInput['fulfillmentMode']) => void;
  readonly onTitleChange: (value: string) => void;
  readonly timeZone: string;
  readonly title: string;
}

export function BasicInfoSection({
  claimDeadlineAt,
  claimStartAt,
  description,
  editable,
  eligibilityMonth,
  fulfillmentMode,
  onClaimDeadlineAtChange,
  onClaimStartAtChange,
  onDescriptionChange,
  onEligibilityMonthChange,
  onFulfillmentModeChange,
  onTitleChange,
  timeZone,
  title,
}: BasicInfoSectionProps) {
  return (
    <section className="panel editor-section">
      <div className="editor-section-title">
        <span>1</span>
        <div>
          <h2>基本信息</h2>
          <p>用户在礼物卡片和领取页看到的内容。</p>
        </div>
      </div>
      <div className="form-grid">
        <label className="span-full">
          礼物名称
          <input
            disabled={!editable}
            maxLength={160}
            onChange={(event) => onTitleChange(event.target.value)}
            required
            value={title}
          />
        </label>
        <label className="span-full">
          礼物说明
          <textarea
            disabled={!editable}
            maxLength={5_000}
            onChange={(event) => onDescriptionChange(event.target.value)}
            rows={5}
            value={description}
          />
        </label>
        <label>
          资格月份
          <input
            disabled={!editable}
            onChange={(event) => onEligibilityMonthChange(`${event.target.value}-01`)}
            required
            type="month"
            value={eligibilityMonth.slice(0, 7)}
          />
          <small>使用这个月冻结的大航海名单。</small>
        </label>
        <label>
          发放方式
          <select
            disabled={!editable}
            onChange={(event) =>
              onFulfillmentModeChange(event.target.value as ReleaseInput['fulfillmentMode'])
            }
            value={fulfillmentMode}
          >
            <option value="HIGHEST_ONLY">仅发对应最高等级礼包</option>
            <option value="CUMULATIVE">逐级累计礼包</option>
          </select>
        </label>
        <label>
          开始领取
          <input
            disabled={!editable}
            onChange={(event) => onClaimStartAtChange(event.target.value)}
            required
            type="datetime-local"
            value={claimStartAt}
          />
          <small>时区：{timeZone}</small>
        </label>
        <label>
          截止领取
          <input
            disabled={!editable}
            onChange={(event) => onClaimDeadlineAtChange(event.target.value)}
            required
            type="datetime-local"
            value={claimDeadlineAt}
          />
          <small>时区：{timeZone}</small>
        </label>
      </div>
    </section>
  );
}
