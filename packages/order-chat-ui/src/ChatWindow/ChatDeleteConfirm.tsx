import styles from './ChatWindow.module.css';

export type ChatDeleteConfirmRenderProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ChatDeleteConfirm({ open, onCancel, onConfirm }: ChatDeleteConfirmRenderProps) {
  if (!open) return null;
  return (
    <div className={styles.deleteConfirmOverlay} role="presentation" onClick={onCancel}>
      <div
        className={styles.deleteConfirmDialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="oc-chat-delete-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="oc-chat-delete-title" className={styles.deleteConfirmTitle}>
          Удалить сообщение?
        </p>
        <p className={styles.deleteConfirmMessage}>
          Сообщение будет скрыто для всех участников. Это действие нельзя отменить.
        </p>
        <div className={styles.deleteConfirmActions}>
          <button type="button" className={styles.deleteConfirmCancel} onClick={onCancel}>
            Отмена
          </button>
          <button type="button" className={styles.deleteConfirmDanger} onClick={onConfirm}>
            Удалить
          </button>
        </div>
      </div>
    </div>
  );
}
