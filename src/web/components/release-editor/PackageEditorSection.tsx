import { Plus, Trash2, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

import type { GuardTier } from '../../api/client';
import type { EditablePackage } from './types';

interface PackageEditorSectionProps {
  readonly editable: boolean;
  readonly onDirty: () => void;
  readonly packages: EditablePackage[];
  readonly setPackages: Dispatch<SetStateAction<EditablePackage[]>>;
  readonly setTierPackageIndexes: Dispatch<SetStateAction<Record<GuardTier, number>>>;
}

export function PackageEditorSection({
  editable,
  onDirty,
  packages,
  setPackages,
  setTierPackageIndexes,
}: PackageEditorSectionProps) {
  const updatePackage = (index: number, patch: Partial<EditablePackage>) => {
    setPackages((current) =>
      current.map((package_, candidate) =>
        candidate === index ? { ...package_, ...patch } : package_,
      ),
    );
  };

  const addPackage = () => {
    onDirty();
    setPackages((current) => [
      ...current,
      {
        description: '',
        items: [{ description: '', name: '', quantity: 1 }],
        name: `礼包 ${current.length + 1}`,
      },
    ]);
  };

  const removePackage = (packageIndex: number) => {
    onDirty();
    setPackages((current) => current.filter((_, index) => index !== packageIndex));
    setTierPackageIndexes(
      (current) =>
        Object.fromEntries(
          Object.entries(current).map(([tier, index]) => [
            tier,
            index === packageIndex ? 0 : index > packageIndex ? index - 1 : index,
          ]),
        ) as Record<GuardTier, number>,
    );
  };

  return (
    <section className="panel editor-section">
      <div className="editor-section-title">
        <span>3</span>
        <div>
          <h2>礼物礼包</h2>
          <p>创建用户最终会收到的礼包和其中物品。</p>
        </div>
        {editable ? (
          <button className="button ghost" onClick={addPackage} type="button">
            <Plus aria-hidden="true" size={16} />
            添加礼包
          </button>
        ) : null}
      </div>
      <div className="package-editor-list">
        {packages.map((package_, packageIndex) => (
          <article className="package-editor" key={packageIndex}>
            <header>
              <strong>礼包 {packageIndex + 1}</strong>
              {editable && packages.length > 1 ? (
                <button
                  className="text-button danger"
                  onClick={() => removePackage(packageIndex)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={14} />
                  删除
                </button>
              ) : null}
            </header>
            <div className="form-grid">
              <label>
                礼包名称
                <input
                  disabled={!editable}
                  onChange={(event) => updatePackage(packageIndex, { name: event.target.value })}
                  required
                  value={package_.name}
                />
              </label>
              <label>
                简短说明
                <input
                  disabled={!editable}
                  onChange={(event) =>
                    updatePackage(packageIndex, { description: event.target.value })
                  }
                  value={package_.description}
                />
              </label>
            </div>
            <div className="item-editor-list">
              {package_.items.map((item, itemIndex) => (
                <div className="item-editor" key={itemIndex}>
                  <input
                    aria-label="物品名称"
                    disabled={!editable}
                    onChange={(event) =>
                      updatePackage(packageIndex, {
                        items: package_.items.map((candidate, index) =>
                          index === itemIndex
                            ? { ...candidate, name: event.target.value }
                            : candidate,
                        ),
                      })
                    }
                    placeholder="物品名称"
                    required
                    value={item.name}
                  />
                  <input
                    aria-label="数量"
                    disabled={!editable}
                    min={1}
                    onChange={(event) =>
                      updatePackage(packageIndex, {
                        items: package_.items.map((candidate, index) =>
                          index === itemIndex
                            ? { ...candidate, quantity: Number(event.target.value) }
                            : candidate,
                        ),
                      })
                    }
                    type="number"
                    value={item.quantity}
                  />
                  <input
                    aria-label="物品说明"
                    disabled={!editable}
                    onChange={(event) =>
                      updatePackage(packageIndex, {
                        items: package_.items.map((candidate, index) =>
                          index === itemIndex
                            ? { ...candidate, description: event.target.value }
                            : candidate,
                        ),
                      })
                    }
                    placeholder="说明（选填）"
                    value={item.description}
                  />
                  {editable && package_.items.length > 1 ? (
                    <button
                      aria-label="删除物品"
                      className="icon-button danger"
                      onClick={() => {
                        onDirty();
                        updatePackage(packageIndex, {
                          items: package_.items.filter((_, index) => index !== itemIndex),
                        });
                      }}
                      type="button"
                    >
                      <X aria-hidden="true" size={16} />
                    </button>
                  ) : null}
                </div>
              ))}
              {editable ? (
                <button
                  className="text-button"
                  onClick={() => {
                    onDirty();
                    updatePackage(packageIndex, {
                      items: [...package_.items, { description: '', name: '', quantity: 1 }],
                    });
                  }}
                  type="button"
                >
                  <Plus aria-hidden="true" size={15} />
                  添加物品
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
