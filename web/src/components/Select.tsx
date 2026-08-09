'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check, ChevronDown } from './icons';

/* ------------------------------------------------------------------ popover */

/**
 * Native <select> popups cannot be styled, so every menu in the app is a
 * custom popover instead. Kept deliberately small: anchored to its trigger,
 * flips upward near the viewport bottom, closes on outside click or Escape.
 */
export function Popover({
  open,
  onClose,
  trigger,
  children,
  align = 'left',
  minWidth,
  full,
}: {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  minWidth?: number;
  full?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [up, setUp] = useState(false);

  useLayoutEffect(() => {
    if (!open || !wrap.current) return;
    const rect = wrap.current.getBoundingClientRect();
    setUp(rect.bottom + 260 > window.innerHeight && rect.top > 280);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div className="pop" ref={wrap} style={full ? { display: 'block', width: '100%' } : undefined}>
      {trigger}
      {open && (
        <div
          className={`menu ${up ? 'up' : 'down'} ${align}`}
          role="listbox"
          style={{ minWidth: minWidth ?? (full ? '100%' : 190) }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  selected,
  onSelect,
  children,
  disabled,
}: {
  selected?: boolean;
  onSelect: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      className={`menu-item ${selected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      {children}
      <Check size={13} className="tick" />
    </button>
  );
}

export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <div className="menu-label">{children}</div>
);

/* ------------------------------------------------------------------ select */

export type Option = {
  value: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
};

export function Select({
  value,
  onChange,
  options,
  disabled,
  placeholder = 'Select…',
  size = 'md',
  ariaLabel,
  full = true,
}: {
  value?: string | null;
  onChange: (value: string) => void;
  options: Option[];
  disabled?: boolean;
  placeholder?: string;
  size?: 'sm' | 'md';
  ariaLabel?: string;
  full?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const current = options.find((o) => o.value === value);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (open) setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  }, [open, options, value]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = options[active];
      if (opt) {
        onChange(opt.value);
        setOpen(false);
      }
    }
  };

  return (
    <Popover
      open={open}
      onClose={close}
      align="left"
      full={full}
      trigger={
        <button
          type="button"
          id={id}
          className={`select-trigger ${size === 'sm' ? 'sm' : ''} ${open ? 'open' : ''}`}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={onKeyDown}
        >
          {current?.icon && <span className="row" style={{ flex: 'none' }}>{current.icon}</span>}
          <span className={`truncate ${current ? '' : 'subtle'}`} style={{ flex: 1, textAlign: 'left' }}>
            {current?.label ?? placeholder}
          </span>
          <ChevronDown size={14} className="subtle" style={{ flex: 'none' }} />
        </button>
      }
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="option"
          aria-selected={o.value === value}
          className={`menu-item ${o.value === value ? 'selected' : ''} ${i === active ? 'focus' : ''}`}
          onMouseEnter={() => setActive(i)}
          onClick={() => {
            onChange(o.value);
            setOpen(false);
          }}
        >
          {o.icon && <span className="row" style={{ flex: 'none' }}>{o.icon}</span>}
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="truncate" style={{ display: 'block' }}>
              {o.label}
            </span>
            {o.hint && <span className="tiny subtle truncate" style={{ display: 'block' }}>{o.hint}</span>}
          </span>
          <Check size={13} className="tick" />
        </button>
      ))}
    </Popover>
  );
}
