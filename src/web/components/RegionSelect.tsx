import { useId, useRef, useState } from 'react';

import type { AddressRegion } from '../lib/address-parser';

export function RegionSelect({
  label,
  options,
  value,
  onChange,
  disabled = false,
  required = false,
}: {
  readonly label: string;
  readonly options: readonly AddressRegion[];
  readonly value: string;
  readonly onChange: (region: AddressRegion) => void;
  readonly disabled?: boolean;
  readonly required?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const filtered = options.filter((option) => option.name.includes(query.trim()));
  const select = (option: AddressRegion) => {
    onChange(option);
    setOpen(false);
    setActive(-1);
  };
  const move = (index: number) => {
    const next = Math.max(0, Math.min(index, filtered.length - 1));
    setActive(next);
    root.current
      ?.querySelector(`[data-option-index="${next}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };
  return (
    <div
      className="region-select"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={`${id}-options`}
        aria-expanded={open}
        aria-activedescendant={open && filtered[active] ? `${id}-${active}` : undefined}
        autoComplete="off"
        disabled={disabled}
        required={required}
        placeholder={disabled ? '请先选择上一级地区' : '搜索或选择'}
        value={open ? query : value}
        onFocus={() => {
          setQuery('');
          setActive(-1);
          setOpen(true);
        }}
        onClick={() => {
          if (!open) {
            setQuery('');
            setOpen(true);
          }
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) {
              setQuery('');
              setOpen(true);
              setActive(0);
            } else move(active + (event.key === 'ArrowDown' ? 1 : -1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const option = filtered[active] ?? (filtered.length === 1 ? filtered[0] : undefined);
            if (open && option) select(option);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open ? (
        <div className="region-options" id={`${id}-options`} role="listbox" aria-label={label}>
          {filtered.length ? (
            filtered.map((option, index) => (
              <button
                id={`${id}-${index}`}
                data-option-index={index}
                className={index === active ? 'region-option active' : 'region-option'}
                key={option.code}
                type="button"
                role="option"
                aria-selected={option.name === value}
                tabIndex={-1}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => select(option)}
              >
                {option.name}
              </button>
            ))
          ) : (
            <p className="quiet-line">没有匹配地区，可切换为手动填写。</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
