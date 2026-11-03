/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdminAwaitingPaymentTimeline } from '@/lib/adminOrderTypes';
import { AwaitingPaymentChips } from './AwaitingPaymentChips';

afterEach(() => cleanup());

function timeline(
  partial: Partial<AdminAwaitingPaymentTimeline> &
    Pick<AdminAwaitingPaymentTimeline, 'chips'>,
): AdminAwaitingPaymentTimeline {
  return {
    overdue: false,
    ageMinutes: 10,
    remindStage: 1,
    ttlMinutes: 4320,
    ...partial,
  };
}

describe('AwaitingPaymentChips', () => {
  it('null timeline → ничего', () => {
    const { container } = render(<AwaitingPaymentChips timeline={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('tone due без ✓; done с ✓; overdue на ttl', () => {
    render(
      <AwaitingPaymentChips
        timeline={timeline({
          overdue: true,
          chips: [
            {
              key: 'remind1',
              label: '5 мин',
              minutes: 5,
              at: '2026-01-01T00:05:00.000Z',
              reached: true,
              mailed: true,
              tone: 'done',
            },
            {
              key: 'remind2',
              label: '24 ч',
              minutes: 1440,
              at: '2026-01-02T00:00:00.000Z',
              reached: true,
              mailed: false,
              tone: 'due',
            },
            {
              key: 'remind3',
              label: '48 ч',
              minutes: 2880,
              at: '2026-01-03T00:00:00.000Z',
              reached: false,
              mailed: false,
              tone: 'upcoming',
            },
            {
              key: 'ttl',
              label: '72 ч',
              minutes: 4320,
              at: '2026-01-04T00:00:00.000Z',
              reached: true,
              mailed: false,
              tone: 'overdue',
            },
          ],
        })}
      />,
    );

    const root = screen.getByTestId('awaiting-payment-chips');
    expect(root.getAttribute('data-overdue')).toBe('1');

    const done = root.querySelector('[data-key="remind1"]');
    expect(done?.getAttribute('data-tone')).toBe('done');
    expect(done?.getAttribute('data-mailed')).toBe('1');
    expect(done?.textContent).toContain('✓');

    const due = root.querySelector('[data-key="remind2"]');
    expect(due?.getAttribute('data-tone')).toBe('due');
    expect(due?.getAttribute('data-mailed')).toBe('0');
    expect(due?.textContent).not.toContain('✓');

    const ttl = root.querySelector('[data-key="ttl"]');
    expect(ttl?.getAttribute('data-tone')).toBe('overdue');
    expect(ttl?.textContent).not.toContain('✓');
  });

  it('failed tone без ✓', () => {
    render(
      <AwaitingPaymentChips
        timeline={timeline({
          chips: [
            {
              key: 'remind1',
              label: '5 мин',
              minutes: 5,
              at: '2026-01-01T00:05:00.000Z',
              reached: true,
              mailed: false,
              tone: 'failed',
            },
          ],
        })}
      />,
    );
    const chip = screen
      .getByTestId('awaiting-payment-chips')
      .querySelector('[data-key="remind1"]');
    expect(chip?.getAttribute('data-tone')).toBe('failed');
    expect(chip?.textContent).not.toContain('✓');
  });
});
