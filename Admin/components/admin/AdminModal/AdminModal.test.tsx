/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminModal } from './AdminModal';
import { AdminConfirmDialog } from './AdminConfirmDialog';
import { AdminConfirmHost, adminConfirm } from './adminConfirm';

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('AdminModal', () => {
  it('Escape closes only the topmost modal and restores body scroll after both close', () => {
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    const { rerender } = render(
      <AdminModal open title="Outer" onClose={closeOuter}>
        <AdminConfirmDialog
          open
          title="Inner"
          message="Sure?"
          onConfirm={() => {}}
          onCancel={closeInner}
        />
      </AdminModal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();

    rerender(
      <AdminModal open title="Outer" onClose={closeOuter}>
        <AdminConfirmDialog
          open={false}
          title="Inner"
          message="Sure?"
          onConfirm={() => {}}
          onCancel={closeInner}
        />
      </AdminModal>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeOuter).toHaveBeenCalledTimes(1);

    rerender(
      <AdminModal open={false} title="Outer" onClose={closeOuter}>
        {null}
      </AdminModal>,
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('closeDisabled ignores Escape and the close button', () => {
    const onClose = vi.fn();
    render(
      <AdminModal open title="Busy" onClose={onClose} closeDisabled>
        <p>body</p>
      </AdminModal>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('danger confirm focuses «Отмена» first', () => {
    render(
      <AdminConfirmDialog
        open
        title="Удалить?"
        message="Нельзя отменить"
        confirmLabel="Удалить"
        danger
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Отмена' }));
  });
});

describe('adminConfirm', () => {
  it('resolves with the user choice via AdminConfirmHost', async () => {
    render(<AdminConfirmHost />);

    let result: Promise<boolean>;
    act(() => {
      result = adminConfirm({ title: 'Удалить', message: 'Точно?', confirmLabel: 'Да' });
    });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Да' }));
    await expect(result!).resolves.toBe(true);

    act(() => {
      result = adminConfirm({ message: 'Ещё раз?' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await expect(result!).resolves.toBe(false);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
