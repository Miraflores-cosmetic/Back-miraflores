'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AdminConfirmDialog } from './AdminConfirmDialog';

export type AdminConfirmOptions = {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type PendingConfirm = AdminConfirmOptions & { resolve: (ok: boolean) => void };

let enqueue: ((req: PendingConfirm) => void) | null = null;

/**
 * Admin-styled replacement for `window.confirm`.
 * Falls back to the native dialog when `AdminConfirmHost` is not mounted.
 */
export function adminConfirm(opts: AdminConfirmOptions): Promise<boolean> {
  if (!enqueue) {
    const text = typeof opts.message === 'string' ? opts.message : (opts.title ?? '');
    return Promise.resolve(window.confirm(text));
  }
  const push = enqueue;
  return new Promise((resolve) => push({ ...opts, resolve }));
}

export function AdminConfirmHost() {
  const [queue, setQueue] = useState<PendingConfirm[]>([]);

  useEffect(() => {
    const push = (req: PendingConfirm) => setQueue((q) => [...q, req]);
    enqueue = push;
    return () => {
      if (enqueue === push) enqueue = null;
    };
  }, []);

  const current = queue[0];

  const settle = useCallback(
    (ok: boolean) => {
      if (!current) return;
      current.resolve(ok);
      setQueue((q) => q.slice(1));
    },
    [current],
  );

  return (
    <AdminConfirmDialog
      open={Boolean(current)}
      title={current?.title ?? 'Подтвердите действие'}
      message={current?.message ?? ''}
      confirmLabel={current?.confirmLabel}
      cancelLabel={current?.cancelLabel}
      danger={current?.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
}
