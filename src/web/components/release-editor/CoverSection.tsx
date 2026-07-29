import { ErrorNotice } from '../Ui';

interface CoverSectionProps {
  readonly coverObjectKey: string | null | undefined;
  readonly coverPreviewUrl: string | null;
  readonly editable: boolean;
  readonly isNew: boolean;
  readonly onFileChange: (file: File | null) => void;
  readonly onUpload: () => void;
  readonly releaseId: string;
  readonly updatedAt: string | Date | undefined;
  readonly uploadError: unknown;
  readonly uploadPending: boolean;
  readonly uploadBlocked: boolean;
}

export function CoverSection({
  coverObjectKey,
  coverPreviewUrl,
  editable,
  isNew,
  onFileChange,
  onUpload,
  releaseId,
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
          ) : coverObjectKey ? (
            <img
              alt="当前礼物封面"
              src={`/api/v1/gift-releases/${releaseId}/cover?version=${String(updatedAt ?? '')}`}
            />
          ) : (
            <div className="gift-placeholder">
              <span>✦</span>
              <small>礼物图片</small>
            </div>
          )}
        </div>
        <div>
          {editable ? (
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
              {isNew ? <small>先保存草稿，即可上传封面。</small> : null}
              {coverPreviewUrl && !isNew ? (
                <>
                  <button
                    className="button secondary"
                    disabled={uploadBlocked}
                    onClick={onUpload}
                    type="button"
                  >
                    {uploadPending ? '正在上传…' : '上传封面'}
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
