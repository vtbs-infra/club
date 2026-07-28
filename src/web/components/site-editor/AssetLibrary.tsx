import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deleteSiteAsset, listSiteAssets, uploadSiteAsset } from '../../api/site-content';

export function AssetLibrary() {
  const client = useQueryClient();
  const assets = useQuery({ queryFn: listSiteAssets, queryKey: ['platform', 'site-assets'] });
  const upload = useMutation({
    mutationFn: uploadSiteAsset,
    onSuccess: async () => client.invalidateQueries({ queryKey: ['platform', 'site-assets'] }),
  });
  const remove = useMutation({
    mutationFn: deleteSiteAsset,
    onSuccess: async () => client.invalidateQueries({ queryKey: ['platform', 'site-assets'] }),
  });
  const error = assets.error ?? upload.error ?? remove.error;

  return (
    <section className="site-asset-library">
      <div className="site-editor-section-heading">
        <div>
          <p className="section-kicker">图片资源</p>
          <h2>品牌与首页图片</h2>
        </div>
        <label className="button">
          {upload.isPending ? '正在处理…' : '上传图片'}
          <input
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
              event.target.value = '';
            }}
            type="file"
          />
        </label>
      </div>
      <p className="muted">
        支持 JPEG、PNG、WebP，单张不超过 5 MB。上传后自动去除元数据、限制尺寸并生成 WebP 与缩略图。
      </p>
      {error ? <div className="page-state page-error">{error.message}</div> : null}
      <div className="site-asset-grid">
        {assets.data?.map((asset) => (
          <article key={asset.id}>
            <img alt={asset.filename} loading="lazy" src={asset.thumbnailUrl} />
            <div>
              <strong>{asset.filename}</strong>
              <span>
                {asset.width}×{asset.height} · {Math.ceil(asset.sizeBytes / 1024)} KB
              </span>
            </div>
            <button
              className="button button-quiet"
              disabled={remove.isPending}
              onClick={() => remove.mutate(asset.id)}
              type="button"
            >
              删除
            </button>
          </article>
        ))}
      </div>
      {assets.data?.length === 0 ? <div className="home-empty-state">还没有上传图片。</div> : null}
    </section>
  );
}
