import { Gift, Upload } from 'lucide-react';

import { ErrorNotice, InlineNotice } from '../Ui';

interface CoverSectionProps {
  readonly coverImageUrl: string | null | undefined;
  readonly coverPreviewUrl: string | null;
  readonly editable: boolean;
  readonly isNew: boolean;
  readonly onFileChange: (file: File | null) => void;
  readonly onUpload: () => void;
  readonly updatedAt: string | Date | undefined;
  readonly uploadError: unknown;
  readonly uploadPending: boolean;
  readonly uploadBlocked: boolean;
}

export function CoverSection({
  coverImageUrl,
  coverPreviewUrl,
  editable,
  isNew,
  onFileChange,
  onUpload,
  updatedAt,
  uploadBlocked,
  uploadError,
  uploadPending,
}: CoverSectionProps) {
  return (
    <section className="panel editor-section">
      <div className="editor-section-title">
        <span>2</span>
        <div>
          <h2>礼物图片</h2>
          <p>这张图片会显示在用户的礼物卡片与详情页。</p>
        </div>
      </div>
      <div className="cover-uploader">
        <div className="cover-preview">
          {coverPreviewUrl ? (
            <img alt="待上传封面预览" src={coverPreviewUrl} />
          ) : coverImageUrl ? (
            <img
              alt="当前礼物封面"
              src={`${coverImageUrl}?version=${encodeURIComponent(String(updatedAt ?? ''))}`}
            />
          ) : (
            <div className="gift-placeholder">
              <span>
                <Gift size={42} strokeWidth={1.55} />
              </span>
              <small>礼物图片</small>
            </div>
          )}
        </div>
        <div>
          {editable && isNew ? (
            <InlineNotice tone="info">
              先创建草稿，再在草稿页面选择并上传封面。创建草稿不会替你保留本地文件。
            </InlineNotice>
          ) : editable ? (
            <>
              <label className="file-button">
                选择图片
                <input
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
                  type="file"
                />
              </label>
              <p>JPEG、PNG 或 WebP，最大 5 MB。系统会统一转为 WebP。</p>
              {coverPreviewUrl ? (
                <>
                  <button
                    className="button secondary"
                    disabled={uploadBlocked}
                    onClick={onUpload}
                    type="button"
                  >
                    {uploadPending ? '正在上传…' : '上传封面'}
                    {!uploadPending ? <Upload aria-hidden="true" size={16} /> : null}
                  </button>
                  <small>上传完成后才能发布，避免忽略当前选择的图片。</small>
                </>
              ) : null}
            </>
          ) : (
            <p>礼物发布后封面也会保持冻结。</p>
          )}
          {uploadError ? <ErrorNotice error={uploadError} /> : null}
        </div>
      </div>
    </section>
  );
}
