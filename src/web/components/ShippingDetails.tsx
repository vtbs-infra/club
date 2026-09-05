import { Copy } from 'lucide-react';
import { useState } from 'react';

export function ShippingDetails({
  shipping,
}: {
  readonly shipping: { readonly carrierName: string; readonly trackingNumber: string };
}) {
  const [copyStatus, setCopyStatus] = useState('');
  return (
    <div className="shipping-summary stack-md">
      <strong>{shipping.carrierName}</strong>
      <p>{shipping.trackingNumber}</p>
      <button
        className="button secondary"
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(shipping.trackingNumber).then(
            () => setCopyStatus('运单号已复制'),
            () => setCopyStatus('复制失败，请选中上方运单号手动复制'),
          );
        }}
      >
        <Copy size={15} aria-hidden="true" />
        复制单号
      </button>
      <span role="status">{copyStatus}</span>
    </div>
  );
}
