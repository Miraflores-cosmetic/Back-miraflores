'use client';

import { useState } from 'react';
import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { formatAdminMoney } from '@/lib/adminFormat';
import {
  matchingPresetPct,
  PCT_PRESETS,
  priceAfterPercentOff,
} from '../orderItemsEditHelpers';
import type { DraftLine } from './types';
import { orderCreateStyles as styles } from './styles';

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function OrderCreateStepItems({
  lines,
  linePctDraft,
  attachGratitude,
  giftOnly = false,
  goodsSubtotal,
  gratitudeItems = [],
  gratitudeBusy = false,
  onAddFromCatalog,
  onAddGiftDenom,
  onChangeQty,
  onChangeUnitPrice,
  onApplyPercent,
  onRemove,
  onResetPrice,
  onLinePctDraft,
  onAttachGratitude,
}: {
  lines: DraftLine[];
  linePctDraft: Record<string, string>;
  attachGratitude: boolean;
  giftOnly?: boolean;
  goodsSubtotal: number;
  gratitudeItems?: Array<{ title: string; qty: number }>;
  gratitudeBusy?: boolean;
  onAddFromCatalog: () => void;
  onAddGiftDenom: () => void;
  onChangeQty: (key: string, qty: number) => void;
  onChangeUnitPrice: (key: string, unitPrice: number) => void;
  onApplyPercent: (key: string, pct: number) => void;
  onRemove: (key: string) => void;
  onResetPrice: (key: string) => void;
  onLinePctDraft: (key: string, raw: string) => void;
  onAttachGratitude: (v: boolean) => void;
}) {
  const [pctOpen, setPctOpen] = useState<Record<string, boolean>>({});

  return (
    <div className={styles.wizardStack}>
      <div className={styles.wizardFooterRight}>
        <AdminCompactBtn type="button" variant="accent" onClick={onAddFromCatalog}>
          Добавить из каталога
        </AdminCompactBtn>
        <AdminCompactBtn type="button" variant="outline" onClick={onAddGiftDenom}>
          Добавить сертификат
        </AdminCompactBtn>
      </div>
      {lines.length === 0 ? (
        <p className={styles.wizardHint}>Добавьте хотя бы одну позицию</p>
      ) : (
        <ul className={styles.wizardLineList}>
          {lines.map((l) => {
            const priceChanged = l.unitPrice !== l.catalogPrice;
            const linePressedPct = matchingPresetPct(l.catalogPrice, l.unitPrice);
            const pctOff =
              l.catalogPrice > 0
                ? Math.round((1 - l.unitPrice / l.catalogPrice) * 1000) / 10
                : 0;
            const draftPct = linePctDraft[l.key] ?? '';
            const toolsOpen = Boolean(pctOpen[l.key]) || priceChanged;
            return (
              <li key={l.key} className={styles.wizardLineCard}>
                <div className={styles.wizardLineRow}>
                  {l.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={l.imageUrl}
                      alt=""
                      className={styles.wizardLineThumb}
                    />
                  ) : (
                    <div
                      className={`${styles.wizardLineThumb} ${styles.wizardLineThumbEmpty}`}
                      aria-hidden
                    >
                      —
                    </div>
                  )}
                  <div className={styles.wizardLineMain}>
                    <div className={styles.wizardLineTitle}>{l.title}</div>
                    <div className={styles.wizardHint}>
                      Каталог: {formatAdminMoney(l.catalogPrice)}
                      {l.sku ? ` · ${l.sku}` : ''}
                    </div>
                  </div>
                  <label className={styles.wizardInlineField}>
                    <span>Кол-во</span>
                    <input
                      className={styles.wizardFieldInput}
                      type="number"
                      min={1}
                      max={9999}
                      value={l.qty}
                      onChange={(e) => {
                        const qty = Math.max(
                          1,
                          Math.min(9999, Math.floor(Number(e.target.value) || 1)),
                        );
                        onChangeQty(l.key, qty);
                      }}
                    />
                  </label>
                  <label className={styles.wizardInlineField}>
                    <span>Цена ₽</span>
                    <input
                      className={styles.wizardFieldInput}
                      type="number"
                      min={0}
                      value={l.unitPrice}
                      onChange={(e) => {
                        const unitPrice = Math.max(
                          0,
                          Math.round(Number(e.target.value) || 0),
                        );
                        onChangeUnitPrice(l.key, unitPrice);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.wizardIconBtn}
                    aria-label={`Удалить ${l.title}`}
                    onClick={() => onRemove(l.key)}
                  >
                    <TrashIcon />
                  </button>
                </div>
                <div className={styles.wizardPriceTools}>
                  <button
                    type="button"
                    className={styles.wizardCollapseBtn}
                    aria-expanded={toolsOpen}
                    onClick={() =>
                      setPctOpen((prev) => ({
                        ...prev,
                        [l.key]: !toolsOpen,
                      }))
                    }
                  >
                    Скидка % от каталога
                    {priceChanged ? ` (−${pctOff > 0 ? pctOff : 0}%)` : ''}
                    <span className={styles.wizardCollapseBtnChevron}>
                      <ChevronIcon />
                    </span>
                  </button>
                  {toolsOpen ? (
                    <div className={styles.itemsEditPriceTools}>
                      <div className={styles.itemsEditPctRow}>
                        {PCT_PRESETS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={styles.itemsEditPctBtn}
                            aria-pressed={linePressedPct === p}
                            aria-label={`Скидка ${p}% · ${l.title}`}
                            onClick={() => onApplyPercent(l.key, p)}
                          >
                            −{p}%
                          </button>
                        ))}
                        <label className={styles.wizardInlineField}>
                          <span className={styles.srOnly}>Своя скидка %</span>
                          <input
                            className={`${styles.wizardFieldInput} ${styles.itemsEditPctField}`}
                            inputMode="decimal"
                            value={draftPct}
                            placeholder="%"
                            aria-label={`Своя скидка % · ${l.title}`}
                            onChange={(e) =>
                              onLinePctDraft(
                                l.key,
                                e.target.value.replace(/[^\d.,]/g, ''),
                              )
                            }
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter') return;
                              e.preventDefault();
                              const pct = Number(String(draftPct).replace(',', '.'));
                              if (!(pct > 0)) return;
                              onApplyPercent(l.key, pct);
                            }}
                          />
                        </label>
                        <AdminCompactBtn
                          type="button"
                          variant="outline"
                          onClick={() => {
                            const pct = Number(String(draftPct).replace(',', '.'));
                            if (!(pct > 0)) return;
                            onApplyPercent(l.key, pct);
                          }}
                        >
                          Применить
                        </AdminCompactBtn>
                        {priceChanged ? (
                          <AdminCompactBtn
                            type="button"
                            variant="outline"
                            onClick={() => onResetPrice(l.key)}
                          >
                            Сбросить
                          </AdminCompactBtn>
                        ) : null}
                      </div>
                      {priceChanged ? (
                        <p className={styles.itemsEditPriceHint}>
                          Было {formatAdminMoney(l.catalogPrice)}
                          {' → '}
                          {formatAdminMoney(l.unitPrice)}
                          {pctOff > 0
                            ? ` (−${pctOff}%)`
                            : pctOff < 0
                              ? ` (+${Math.abs(pctOff)}%)`
                              : ''}
                          {' · % от каталога'}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className={styles.wizardSubtotal}>
        Товары: {formatAdminMoney(goodsSubtotal)}
      </p>
      {giftOnly ? (
        <p className={styles.wizardHint}>
          Электронные сертификаты — доставка и благодарности не применяются
        </p>
      ) : (
        <>
          <div className={styles.labelCheckboxRow}>
            <AdminCheckbox
              id="order-create-gratitude"
              className={styles.adminCheckboxForm}
              checked={attachGratitude}
              onChange={(e) => onAttachGratitude(e.target.checked)}
            />
            <label htmlFor="order-create-gratitude">
              Добавить подарки благодарности (по порогу)
            </label>
          </div>
          {attachGratitude ? (
            gratitudeBusy ? (
              <p className={styles.wizardHint}>Считаем подарки благодарности…</p>
            ) : gratitudeItems.length > 0 ? (
              <div className={styles.wizardGratitudePreview}>
                По порогу будут добавлены:
                <ul>
                  {gratitudeItems.map((g, i) => (
                    <li key={`${g.title}-${i}`}>
                      {g.title} × {g.qty}
                    </li>
                  ))}
                </ul>
              </div>
            ) : lines.length > 0 ? (
              <p className={styles.wizardHint}>
                Для текущей суммы товаров подарки благодарности не положены
              </p>
            ) : null
          ) : null}
        </>
      )}
    </div>
  );
}

/** Helper for parent when applying % — keeps catalog base. */
export function unitPriceAfterPercent(catalogPrice: number, pct: number) {
  return priceAfterPercentOff(catalogPrice, pct);
}
