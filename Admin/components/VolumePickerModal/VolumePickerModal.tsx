'use client';

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  isVolumeOptionOutOfStock,
  type VolumePickerOption,
} from '@miraflores/volume-picker';
import { formatRub } from '@/lib/publicCatalog';
import styles from './VolumePickerModal.module.css';

export type { VolumePickerOption };

type VolumePickerModalProps = {
  open: boolean;
  title?: string;
  options: VolumePickerOption[];
  onSelect: (option: VolumePickerOption) => void;
  onClose: () => void;
};

export function VolumePickerModal({
  open,
  title = 'Выберите объём',
  options,
  onSelect,
  onClose,
}: VolumePickerModalProps) {
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const root = modalRef.current;
    const firstBtn = root?.querySelector<HTMLElement>('button:not([disabled])');
    firstBtn?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const el = returnFocusRef.current;
      if (el && document.contains(el) && typeof el.focus === 'function') {
        try {
          el.focus({ preventScroll: true });
        } catch {
          el.focus();
        }
      }
      returnFocusRef.current = null;
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <p id={titleId} className={styles.title}>
          {title}
        </p>
        <ul className={styles.list} role="listbox" aria-label={title}>
          {options.map((opt) => {
            const oos = isVolumeOptionOutOfStock(opt);
            return (
              <li key={opt.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  aria-disabled={oos || undefined}
                  disabled={oos}
                  className={[styles.option, oos ? styles.optionOos : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => {
                    if (oos) return;
                    onSelect(opt);
                  }}
                >
                  <span className={styles.optionLabel}>
                    {opt.label}
                    {oos ? <span className={styles.oosHint}>нет в наличии</span> : null}
                  </span>
                  <span className={styles.optionPrice}>
                    {opt.oldPrice != null && opt.oldPrice > opt.price ? (
                      <span className={styles.oldPrice}>{formatRub(opt.oldPrice)}</span>
                    ) : null}
                    <span className={styles.price}>{formatRub(opt.price)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className={styles.cancelBtn} onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>,
    document.body,
  );
}
