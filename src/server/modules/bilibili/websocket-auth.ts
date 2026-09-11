import { BilibiliProviderError } from './passport-client.js';

/** Read operation 8 directly: the SDK drops JSON bodies in protocol-1 authentication frames. */
export function readBilibiliWebSocketAuth(bytes: Uint8Array): number | null {
  if (bytes.byteLength > 8 * 1024 * 1024)
    throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let result: number | null = null;
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 16 > bytes.length) throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
    const length = view.getUint32(offset);
    const header = view.getUint16(offset + 4);
    const protocol = view.getUint16(offset + 6);
    const operation = view.getUint32(offset + 8);
    if (length < 16 || header < 16 || header > length || offset + length > bytes.length)
      throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
    if (operation === 8) {
      if (protocol > 1 || length - header > 4096)
        throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
      let payload: unknown;
      try {
        payload = JSON.parse(
          new TextDecoder().decode(bytes.subarray(offset + header, offset + length)),
        );
      } catch {
        throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
      }
      if (
        !payload ||
        typeof payload !== 'object' ||
        !('code' in payload) ||
        typeof payload.code !== 'number' ||
        !Number.isSafeInteger(payload.code)
      )
        throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
      if (result !== null && result !== payload.code)
        throw new BilibiliProviderError('BILIBILI_INVALID_RESPONSE');
      result = payload.code;
    }
    offset += length;
  }
  return result;
}
