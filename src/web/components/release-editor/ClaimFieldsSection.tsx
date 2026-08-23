import { Plus } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

import type { GiftFormField } from '../../api/client';
import type { EditableField } from './types';

interface ClaimFieldsSectionProps {
  readonly editable: boolean;
  readonly fields: EditableField[];
  readonly onDirty: () => void;
  readonly setFields: Dispatch<SetStateAction<EditableField[]>>;
}

export function ClaimFieldsSection({
  editable,
  fields,
  onDirty,
  setFields,
}: ClaimFieldsSectionProps) {
  const updateField = (index: number, patch: Partial<EditableField>) => {
    setFields((current) =>
      current.map((candidate, candidateIndex) =>
        candidateIndex === index ? { ...candidate, ...patch } : candidate,
      ),
    );
  };

  const addField = () => {
    onDirty();
    setFields((current) => [
      ...current,
      {
        key: `field_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
        label: '',
        options: [],
        required: false,
        type: 'TEXT',
      },
    ]);
  };

  return (
    <section className="panel editor-section">
      <div className="editor-section-title">
        <span>5</span>
        <div>
          <h2>领取时需要填写的内容</h2>
          <p>收货地址无需重复配置；这里只添加尺码、款式等礼物专属选项。</p>
        </div>
        {editable ? (
          <button className="button ghost" onClick={addField} type="button">
            <Plus aria-hidden="true" size={16} />
            添加填写项
          </button>
        ) : null}
      </div>
      {fields.length === 0 ? (
        <p className="quiet-line">无需额外填写内容，用户只需选择收货地址。</p>
      ) : (
        <div className="field-editor-list">
          {fields.map((field, index) => (
            <article className="field-editor" key={field.key}>
              <label>
                显示名称
                <input
                  disabled={!editable}
                  onChange={(event) => updateField(index, { label: event.target.value })}
                  placeholder="例如：T恤尺码"
                  required
                  value={field.label}
                />
              </label>
              <label>
                填写方式
                <select
                  disabled={!editable}
                  onChange={(event) =>
                    updateField(index, {
                      options: [],
                      type: event.target.value as GiftFormField['type'],
                    })
                  }
                  value={field.type}
                >
                  <option value="TEXT">单行文字</option>
                  <option value="TEXTAREA">多行文字</option>
                  <option value="SELECT">下拉选择</option>
                  <option value="RADIO">单项选择</option>
                  <option value="CHECKBOX">确认勾选</option>
                </select>
              </label>
              <label className="check-field">
                <input
                  checked={field.required}
                  disabled={!editable}
                  onChange={(event) => updateField(index, { required: event.target.checked })}
                  type="checkbox"
                />
                必填
              </label>
              {field.type === 'SELECT' || field.type === 'RADIO' ? (
                <label className="span-full">
                  可选项（每行一个）
                  <textarea
                    disabled={!editable}
                    onChange={(event) =>
                      updateField(index, { options: event.target.value.split('\n') })
                    }
                    rows={4}
                    value={field.options.join('\n')}
                  />
                </label>
              ) : null}
              {editable ? (
                <button
                  className="text-button danger"
                  onClick={() => {
                    onDirty();
                    setFields((current) =>
                      current.filter((_, candidateIndex) => candidateIndex !== index),
                    );
                  }}
                  type="button"
                >
                  删除填写项
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
