import { useEffect, useId, useRef, useState } from 'react';

import type { AddressPayloadContract } from '../../shared/contracts/addresses';
import {
  ADDRESS_FIELDS,
  ADDRESS_TEXT_LIMIT as TEXT_LIMIT,
  hasAddressContent,
} from '../lib/address-fields';
import type { ParsedAddress } from '../lib/address-parser';
import { InlineNotice } from './Ui';

// Keep the data/parser in a separate chunk; editing an address does not load it.
export function AddressPaste({
  autoFocus,
  payload,
  disabled,
  onApply,
  onPendingChange,
}: {
  readonly autoFocus: boolean;
  readonly payload: AddressPayloadContract;
  readonly disabled: boolean;
  readonly onApply: (next: AddressPayloadContract) => void;
  readonly onPendingChange: (pending: boolean) => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<ParsedAddress | null>(null);
  const [notice, setNotice] = useState('');
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [undo, setUndo] = useState<{
    before: AddressPayloadContract;
    after: AddressPayloadContract;
  } | null>(null);
  const request = useRef(0);
  const current = useRef({ payload, disabled, onApply });
  current.current = { payload, disabled, onApply };

  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );
  useEffect(() => {
    onPendingChange(busy || candidate !== null);
  }, [busy, candidate, onPendingChange]);

  function apply(parsed: ParsedAddress) {
    setUndo({ before: current.current.payload, after: parsed.payload });
    current.current.onApply(parsed.payload);
    setCandidate(null);
    setWarnings(parsed.warnings);
    setNotice('已填入识别结果，请核对后保存。');
  }

  function changeText(value: string) {
    request.current += 1;
    setBusy(false);
    setCandidate(null);
    setNotice('');
    setWarnings([]);
    setText(value);
  }

  async function recognize(value: string, ticket = ++request.current) {
    setCandidate(null);
    setWarnings([]);
    if (!value.trim() || value.length > TEXT_LIMIT) {
      setNotice(
        value.trim()
          ? `整条地址不能超过 ${TEXT_LIMIT} 个字符，请只粘贴一个地址。`
          : '请先粘贴收货地址。',
      );
      setBusy(false);
      return;
    }
    setBusy(true);
    setNotice('正在本地识别…');
    const before = JSON.stringify(current.current.payload);
    try {
      const { parseAddress } = await import('../lib/address-parser');
      if (ticket !== request.current || current.current.disabled) return;
      const parsed = parseAddress(value);
      setWarnings(parsed.warnings);
      if (!parsed.recognized) {
        setNotice('未能安全识别，请修改原文后重试，或在下方手动填写。');
      } else if (
        parsed.complete &&
        !hasAddressContent(current.current.payload) &&
        before === JSON.stringify(current.current.payload)
      ) {
        apply(parsed);
      } else {
        setCandidate(parsed);
        setNotice('请核对识别预览，确认后再替换下方表单。');
      }
    } catch {
      if (ticket === request.current) setNotice('识别资源加载失败，请重试，或在下方手动填写。');
    } finally {
      if (ticket === request.current) setBusy(false);
    }
  }

  async function pasteFromClipboard() {
    const ticket = ++request.current;
    setBusy(true);
    setCandidate(null);
    setWarnings([]);
    setNotice('正在读取剪贴板…');
    try {
      const value = await navigator.clipboard.readText();
      if (ticket !== request.current || current.current.disabled) return;
      if (value.length <= TEXT_LIMIT) setText(value);
      await recognize(value, ticket);
    } catch {
      if (ticket === request.current) {
        setBusy(false);
        setNotice('无法读取剪贴板，请在输入框长按粘贴或使用 Ctrl+V，然后自动识别。');
      }
    }
  }

  const canUndo = undo !== null && JSON.stringify(payload) === JSON.stringify(undo.after);
  return (
    <section className="address-paste stack-md" aria-label="整条地址识别">
      <label htmlFor={`${id}-text`}>粘贴整条地址</label>
      <textarea
        id={`${id}-text`}
        aria-describedby={`${id}-help`}
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        maxLength={TEXT_LIMIT}
        onChange={(event) => changeText(event.target.value)}
        onPaste={(event) => {
          event.preventDefault();
          const value = event.clipboardData.getData('text/plain');
          if (value.length <= TEXT_LIMIT) changeText(value);
          void recognize(value);
        }}
        placeholder="粘贴从淘宝等平台复制的收件人、电话和完整地址，支持空格、逗号或换行。"
        rows={3}
        spellCheck={false}
        value={text}
      />
      <small id={`${id}-help`}>
        仅在当前浏览器识别中国大陆地址，不上传粘贴原文。识别后仍需核对并保存。
      </small>
      <div className="form-actions">
        <button
          className="button secondary"
          disabled={disabled || busy}
          onClick={pasteFromClipboard}
          type="button"
        >
          从剪贴板粘贴
        </button>
        <button
          className="button ghost"
          disabled={disabled || busy || !text.trim()}
          onClick={() => recognize(text)}
          type="button"
        >
          重新识别
        </button>
        {canUndo ? (
          <button
            className="text-button"
            disabled={disabled || busy}
            onClick={() => {
              request.current += 1;
              current.current.onApply(undo.before);
              setUndo(null);
              setCandidate(null);
              setWarnings([]);
              setNotice('已撤销本次填入，未修改已保存的地址。');
            }}
            type="button"
          >
            撤销本次填入
          </button>
        ) : null}
      </div>
      <div aria-live="polite" aria-atomic="true">
        {notice ? <p className="quiet-line">{notice}</p> : null}
        {warnings.length ? (
          <InlineNotice tone="warning">
            <ul>
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </InlineNotice>
        ) : null}
      </div>
      {candidate ? (
        <div className="address-paste-preview stack-md">
          <p>
            应用后将替换整组收件信息，未识别字段会留空，不会混用原来的姓名、电话或地址。地址名称和默认设置保持不变。
          </p>
          <dl>
            {ADDRESS_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>
                  {payload[key] && payload[key] !== candidate.payload[key] ? (
                    <>
                      <span className="quiet-line">原：{payload[key]}</span>
                      <br />
                    </>
                  ) : null}
                  {candidate.payload[key] || '未识别 / 留空'}
                </dd>
              </div>
            ))}
          </dl>
          <div className="form-actions">
            <button
              className="button secondary"
              disabled={disabled}
              onClick={() => apply(candidate)}
              type="button"
            >
              确认替换表单
            </button>
            <button
              className="button ghost"
              onClick={() => {
                setCandidate(null);
                setWarnings([]);
                setNotice('未应用识别结果，下方表单保持不变。');
              }}
              type="button"
            >
              不应用
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
