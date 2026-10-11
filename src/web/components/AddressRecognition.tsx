import { useId, useState } from 'react';

import type { AddressPayload } from '../api/client';
import type { AddressRecognition as Recognition, recognizeAddress } from '../lib/address-parser';

export function AddressRecognition({
  recognize,
  onApply,
  autoFocus = false,
}: {
  readonly recognize: typeof recognizeAddress;
  readonly onApply: (value: AddressPayload) => void;
  readonly autoFocus?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [result, setResult] = useState<Recognition | null>(null);
  const [candidateIndex, setCandidateIndex] = useState(-1);
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');

  const apply = (recognition: Recognition, index: number, selectedPhone: string) => {
    const candidate = recognition.candidates[index];
    if (!candidate) return;
    onApply({
      ...candidate,
      countryRegion: '中国大陆',
      recipientName: recognition.recipientName,
      phone: selectedPhone,
      postalCode: recognition.postalCode,
      userNote: recognition.userNote,
    });
    setResult(null);
  };

  return (
    <section className="address-recognition" aria-label="粘贴识别地址">
      <label htmlFor={id}>
        粘贴收货信息
        <small>支持中国大陆地址；识别后请核对姓名、电话和门牌号。</small>
      </label>
      <textarea
        id={id}
        autoFocus={autoFocus}
        maxLength={2000}
        rows={3}
        placeholder="例如：张三 13800138000 浙江省杭州市西湖区文三路88号2幢301室"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setResult(null);
          setMessage('');
        }}
      />
      <div className="address-recognition-actions">
        <small>在当前浏览器识别，核对后再保存。</small>
        <button
          className="button secondary"
          type="button"
          disabled={!text.trim()}
          onClick={() => {
            const next = recognize(text);
            setResult(null);
            setMessage('');
            if (!next) {
              setMessage(
                '未识别到有效的单条收货信息，请一次粘贴一条地址并补充姓名、电话或省市区，也可以直接手动填写。',
              );
              return;
            }
            const index = next.candidates.length === 1 ? 0 : -1;
            const selectedPhone = next.phones.length === 1 ? next.phones[0]! : '';
            if (index >= 0 && next.phones.length <= 1) apply(next, index, selectedPhone);
            else {
              setCandidateIndex(index);
              setPhone(selectedPhone);
              setResult(next);
            }
          }}
        >
          识别地址
        </button>
      </div>
      <div aria-live="polite">
        {message ? <p className="quiet-line">{message}</p> : null}
        {result ? (
          <div className="stack-md recognition-choices">
            <p>识别到多个可能结果，请选择后填入表单。</p>
            {result.candidates.length > 1 ? (
              <fieldset className="radio-field">
                <legend>选择所在地区</legend>
                {result.candidates.map((candidate, index) => (
                  <label
                    className="check-field"
                    key={[candidate.province, candidate.city, candidate.district].join('/')}
                  >
                    <input
                      type="radio"
                      name={`${id}-region`}
                      checked={candidateIndex === index}
                      onChange={() => setCandidateIndex(index)}
                    />
                    {[candidate.province, candidate.city, candidate.district].join(' / ')}
                  </label>
                ))}
              </fieldset>
            ) : null}
            {result.phones.length > 1 ? (
              <fieldset className="radio-field">
                <legend>选择联系电话</legend>
                {result.phones.map((candidate) => (
                  <label className="check-field" key={candidate}>
                    <input
                      type="radio"
                      name={`${id}-phone`}
                      checked={phone === candidate}
                      onChange={() => setPhone(candidate)}
                    />
                    {candidate}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <button
              className="button secondary"
              type="button"
              disabled={candidateIndex < 0 || (result.phones.length > 1 && !phone)}
              onClick={() => apply(result, candidateIndex, phone)}
            >
              使用此识别结果
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
