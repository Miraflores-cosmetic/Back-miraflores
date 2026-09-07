'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { PrimaryBtn } from '@/components/PrimaryBtn/PrimaryBtn';
import { focusablesIn, trapFocusKeydown } from '@/lib/focusTrap';
import styles from './ConfirmDialog.module.css';

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Money / destructive confirms. */
  danger?: boolean;
  /** Extra controls (e.g. reject reason). */
  children?: ReactNode;
  /** Disable confirm (e.g. empty required reason). */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  danger = false,
  children,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const nodes = panel ? focusablesIn(panel) : [];
    (nodes[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (panel) trapFocusKeydown(e, panel);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <p className={styles.message}>{message}</p>
        {children ? <div className={styles.extra}>{children}</div> : null}
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>
            {cancelLabel}
          </button>
          <PrimaryBtn
            type="button"
            className={[styles.confirm, danger ? styles.confirmDanger : '']
              .filter(Boolean)
              .join(' ')}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </PrimaryBtn>
        </div>
      </div>
    </div>
  );
}
