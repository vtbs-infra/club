import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { deleteSiteAsset, listSiteAssets, uploadSiteAsset } from '../../api/site-content';
import { ErrorNotice, LoadingState } from '../Ui';

export function AssetLibrary() {
  const inputRef = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const assets = useQuery({
    queryFn: listSiteAssets,
    queryKey: ['admin', 'site-assets'],
  });
  const upload = useMutation({
    mutationFn: uploadSiteAsset,
    onSuccess: async () => {
      if (inputRef.current) inputRef.current.value = '';
      await client.invalidateQueries({ queryKey: ['admin', 'site-assets'] });
    },
  });
  const remove = useMutation({
    mutationFn: deleteSiteAsset,
    onSuccess: async () => client.invalidateQueries({ queryKey: ['admin', 'site-assets'] }),
  });

  if (assets.isPending) return <LoadingState label="正在读取图片资源…" />;
  const items = assets.data ?? [];
  return (
    <section className="site-assets-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">BRAND ASSETS</p>
          <h2>品牌与首页图片</h2>
          <p>支持 JPEG、PNG、WebP，单张不超过 5 MB；上传后自动去除元数据并生成 WebP。</p>
        </div>
        <label className="button primary asset-upload-button">
          {upload.isPending ? '正在处理…' : '上传图片'}
          <input
            accept="image/jpeg,image/png,image/webp"
            disabled={upload.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
            }}
            ref={inputRef}
            type="file"
          />
        </label>
      </div>
      {assets.error || upload.error || remove.error ? (
        <ErrorNotice error={assets.error ?? upload.error ?? remove.error} />
      ) : null}
      {items.length === 0 ? (
        <p className="quiet-line">还没有上传图片。</p>
      ) : (
        <div className="site-asset-grid">
          {items.map((asset) => (
            <article key={asset.id}>
              <img alt={asset.filename} loading="lazy" src={asset.thumbnailUrl} />
              <div>
                <strong title={asset.filename}>{asset.filename}</strong>
                <small>
                  {asset.width} × {asset.height} · {Math.ceil(asset.sizeBytes / 1024)} KB
                </small>
                <button
                  className="text-button danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(asset.id)}
                  type="button"
                >
                  删除图片
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
