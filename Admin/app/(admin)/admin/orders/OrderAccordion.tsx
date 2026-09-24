'use client';

import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import orderStyles from './orders.module.css';

const styles = { ...catalogStyles, ...orderStyles };

export function OrderAccordion({
  id,
  title,
  count,
  open,
  onToggle,
  actions,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.orderAccordion} data-open={open ? 'true' : 'false'}>
      <div className={styles.orderAccordionHead}>
        <button
          type="button"
          className={styles.orderAccordionToggle}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          id={`${id}-heading`}
          onClick={onToggle}
        >
          <span className={styles.orderAccordionChevron} aria-hidden>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="m9 6 6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className={styles.orderAccordionTitle}>{title}</span>
          {count ? <span className={styles.orderAccordionCount}>{count}</span> : null}
        </button>
        {actions ? (
          <div className={styles.orderAccordionActions} onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        ) : null}
      </div>
      {open ? (
        <div
          className={styles.orderAccordionBody}
          id={`${id}-panel`}
          role="region"
          aria-labelledby={`${id}-heading`}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function OrderIconBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.orderIconBtn}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 20h9"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        <path
          d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
