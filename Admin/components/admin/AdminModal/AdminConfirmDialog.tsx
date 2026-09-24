'use client';

import { useId, useRef, type ReactNode } from 'react';
import { AdminModal, AdminModalActions } from './AdminModal';
import styles from './AdminModal.module.css';

export type AdminConfirmDialogProps = {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive / money confirms: red button, focus starts on «Отмена». */
  danger?: boolean;
  /** Extra controls (e.g. reject reason). */
  children?: ReactNode;
  /** Disable confirm (e.g. empty required reason). */
  confirmDisabled?: boolean;
  /** Request in flight: both buttons and closing are blocked. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function AdminConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  danger = false,
  children,
  confirmDisabled = false,
  busy = false,
  onConfirm,
  onCancel,
}: AdminConfirmDialogProps) {
  const messageId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <AdminModal
      open={open}
      title={title}
      onClose={onCancel}
      size="sm"
      role="alertdialog"
      describedBy={messageId}
      closeDisabled={busy}
      initialFocusRef={children ? undefined : danger ? cancelRef : confirmRef}
      footer={
        <AdminModalActions
          onCancel={onCancel}
          onConfirm={onConfirm}
          confirmLabel={confirmLabel}
          cancelLabel={cancelLabel}
          confirmDisabled={confirmDisabled || busy}
          cancelDisabled={busy}
          danger={danger}
          confirmRef={confirmRef}
          cancelRef={cancelRef}
        />
      }
    >
      {message ? (
        <p id={messageId} className={styles.confirmMessage}>
          {message}
        </p>
      ) : null}
      {children ? <div className={styles.confirmExtra}>{children}</div> : null}
    </AdminModal>
  );
}
