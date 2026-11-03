import type { AdminAwaitingPaymentTimeline } from '@/lib/adminOrderTypes';
import styles from './orders.module.css';

export function AwaitingPaymentChips({
  timeline,
  compact = false,
}: {
  timeline: AdminAwaitingPaymentTimeline | null | undefined;
  compact?: boolean;
}) {
  if (!timeline?.chips?.length) return null;
  return (
    <div
      className={[
        styles.awaitingChips,
        compact ? styles.awaitingChipsCompact : '',
        timeline.overdue ? styles.awaitingChipsOverdue : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={
        timeline.overdue
          ? `Без оплаты более ${timeline.chips.find((c) => c.key === 'ttl')?.label ?? '72 ч'} — отмена только вручную`
          : 'Интервалы напоминаний об оплате (✓ = письмо отправлено)'
      }
      data-testid="awaiting-payment-chips"
      data-overdue={timeline.overdue ? '1' : '0'}
    >
      {timeline.chips.map((chip) => (
        <span
          key={chip.key}
          data-key={chip.key}
          data-tone={chip.tone}
          data-mailed={chip.mailed ? '1' : '0'}
          className={[
            styles.awaitingChip,
            chip.tone === 'done' ? styles.awaitingChipDone : '',
            chip.tone === 'due' ? styles.awaitingChipDue : '',
            chip.tone === 'failed' ? styles.awaitingChipFailed : '',
            chip.tone === 'overdue' ? styles.awaitingChipOverdue : '',
            chip.tone === 'upcoming' ? styles.awaitingChipUpcoming : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {chip.label}
          {chip.key !== 'ttl' && chip.mailed ? ' ✓' : ''}
        </span>
      ))}
    </div>
  );
}
