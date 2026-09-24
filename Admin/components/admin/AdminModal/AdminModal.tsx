'use client';

import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import { focusablesIn, trapFocusKeydown } from '@/lib/focusTrap';
import styles from './AdminModal.module.css';

const BASE_Z_INDEX = 1250;
const FORM_FIELD = 'input:not([type="hidden"]):not([readonly]), textarea:not([readonly]), select';

type StackEntry = { token: symbol; node: HTMLElement | null };

/** Open modals, bottom → top: Escape / Tab / scroll lock belong to the topmost one. */
const modalStack: StackEntry[] = [];
let bodyOverflowBeforeLock: string | null = null;

/**
 * Child effects run before parent ones, so a nested modal opened together with its
 * parent registers first — the parent must still go below it.
 */
function pushModal(entry: StackEntry): number {
  if (modalStack.length === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  const nestedIdx = modalStack.findIndex(
    (e) => e.node && entry.node && entry.node !== e.node && entry.node.contains(e.node),
  );
  const idx = nestedIdx === -1 ? modalStack.length : nestedIdx;
  modalStack.splice(idx, 0, entry);
  return idx;
}

function popModal(token: symbol) {
  const idx = modalStack.findIndex((e) => e.token === token);
  if (idx !== -1) modalStack.splice(idx, 1);
  if (modalStack.length === 0 && bodyOverflowBeforeLock !== null) {
    document.body.style.overflow = bodyOverflowBeforeLock;
    bodyOverflowBeforeLock = null;
  }
}

function isTopModal(token: symbol): boolean {
  return modalStack[modalStack.length - 1]?.token === token;
}

function CloseBtn({
  onClick,
  label,
  disabled,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={catalogStyles.modalCloseIconBtn}
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        className={catalogStyles.modalCloseIconSvg}
      >
        <path
          d="M18 6L6 18M6 6l12 12"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export type AdminModalSize = 'sm' | 'default' | 'wide' | 'assistant';

const SIZE_CLASS: Record<AdminModalSize, string> = {
  sm: styles.panelSm,
  default: '',
  wide: styles.panelWide,
  assistant: `${styles.panelWide} ${styles.panelAssistant}`,
};

export function AdminModal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
  size,
  keepMounted = false,
  closeDisabled = false,
  bodyFlush = false,
  role = 'dialog',
  describedBy,
  initialFocusRef,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** @deprecated use `size="wide"` */
  wide?: boolean;
  size?: AdminModalSize;
  /** Keep children mounted while closed (state / in-flight abort). */
  keepMounted?: boolean;
  /** Ignore Escape, backdrop and the close button (e.g. request in flight). */
  closeDisabled?: boolean;
  /** Body without padding — content (chat, map) fills the panel edge to edge. */
  bodyFlush?: boolean;
  role?: 'dialog' | 'alertdialog';
  describedBy?: string;
  /** Focused on open; defaults to the first focusable field in the body. */
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [depth, setDepth] = useState(0);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeDisabledRef = useRef(closeDisabled);
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    if (!open) return;
    const token = Symbol('admin-modal');
    setDepth(pushModal({ token, node: overlayRef.current }));
    const restoreTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const bodyNodes = bodyRef.current ? focusablesIn(bodyRef.current) : [];
      const target =
        initialFocusRef?.current ??
        bodyNodes.find((el) => el.matches(FORM_FIELD)) ??
        bodyNodes[0] ??
        panel;
      target.focus({ preventScroll: true });
    }

    const onKey = (e: KeyboardEvent) => {
      if (!isTopModal(token)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!closeDisabledRef.current) onCloseRef.current();
        return;
      }
      if (panelRef.current) trapFocusKeydown(e, panelRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      popModal(token);
      if (restoreTo?.isConnected) restoreTo.focus({ preventScroll: true });
    };
    // initialFocusRef is read once on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open && !keepMounted) return null;

  const resolvedSize: AdminModalSize = size ?? (wide ? 'wide' : 'default');
  const panelClass = [styles.panel, SIZE_CLASS[resolvedSize]].filter(Boolean).join(' ');
  const requestClose = () => {
    if (!closeDisabled) onClose();
  };

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      role="presentation"
      hidden={!open}
      style={open ? { zIndex: BASE_Z_INDEX + depth * 10 } : { display: 'none' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        className={panelClass}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        aria-hidden={!open}
        tabIndex={-1}
      >
        <div className={styles.panelHead}>
          <h2 id={titleId} className={styles.panelTitle}>
            {title}
          </h2>
          <CloseBtn onClick={requestClose} label="Закрыть" disabled={closeDisabled} />
        </div>
        <div
          ref={bodyRef}
          className={bodyFlush ? `${styles.body} ${styles.bodyFlush}` : styles.body}
        >
          {children}
        </div>
        {footer ? <div className={styles.panelFooter}>{footer}</div> : null}
      </div>
    </div>
  );
}

export function AdminModalActions({
  onCancel,
  onConfirm,
  confirmLabel = 'Готово',
  cancelLabel = 'Отмена',
  confirmDisabled,
  cancelDisabled,
  danger = false,
  confirmRef,
  cancelRef,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  danger?: boolean;
  confirmRef?: RefObject<HTMLButtonElement>;
  cancelRef?: RefObject<HTMLButtonElement>;
}) {
  return (
    <>
      <AdminCompactBtn
        ref={cancelRef}
        type="button"
        variant="outline"
        onClick={onCancel}
        disabled={cancelDisabled}
      >
        {cancelLabel}
      </AdminCompactBtn>
      <AdminCompactBtn
        ref={confirmRef}
        type="button"
        variant={danger ? 'danger' : 'accent'}
        onClick={onConfirm}
        disabled={confirmDisabled}
      >
        {confirmLabel}
      </AdminCompactBtn>
    </>
  );
}
