'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  MENU_COVERED_EVENT,
  TransitionLink,
  useSiteTransition,
} from '@/components/SiteTransition';
import styles from './Header.module.css';

export type SearchHit = {
  id: string;
  title: string;
  href: string;
  subtitle?: string | null;
  imageUrl?: string | null;
};

export type SearchGroup = {
  key: string;
  label: string;
  items: SearchHit[];
};

type FlatHit = SearchHit & { groupLabel: string; groupKey: string };

type Props = {
  open: boolean;
  closing: boolean;
  onClose: () => void;
  onNavigate: () => void;
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
  );
}

function ClearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M15 5L5 15M5 5l10 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

async function fetchSearchGroups(
  q: string,
  signal?: AbortSignal,
): Promise<SearchGroup[]> {
  const res = await fetch(`/api/public/search?q=${encodeURIComponent(q)}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error('search failed');
  const data = (await res.json().catch(() => ({}))) as { groups?: SearchGroup[] };
  return Array.isArray(data.groups) ? data.groups : [];
}

function HitGlyph({ type }: { type: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    'aria-hidden': true as const,
  };
  const stroke = {
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (type) {
    case 'category':
      return (
        <svg {...common}>
          <path d="M3 7.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9.5a2 2 0 0 0-2-2h-7l-1.5-2H5a2 2 0 0 0-2 2Z" {...stroke} />
        </svg>
      );
    case 'product':
      return (
        <svg {...common}>
          <path
            d="M8 7h8c2.8 0 3.1 1.3 3.3 2.9l.8 6.2c.2 2-.4 3.7-3.3 3.7H7.2c-2.9 0-3.5-1.7-3.3-3.7l.8-6.2C5 8.3 5.3 7 8 7Z"
            {...stroke}
          />
          <path d="M8 8.2V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5v2.7" {...stroke} />
        </svg>
      );
    case 'tag':
      return (
        <svg {...common}>
          <path d="M12 3H5.5A2.5 2.5 0 0 0 3 5.5V12l9.4 9.4a1.5 1.5 0 0 0 2.1 0L21.4 14.5a1.5 1.5 0 0 0 0-2.1L12 3Z" {...stroke} />
          <circle cx="8" cy="8" r="1.2" fill="currentColor" />
        </svg>
      );
    case 'collection':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="8" height="8" rx="1" {...stroke} />
          <rect x="13" y="3" width="8" height="8" rx="1" {...stroke} />
          <rect x="3" y="13" width="8" height="8" rx="1" {...stroke} />
          <rect x="13" y="13" width="8" height="8" rx="1" {...stroke} />
        </svg>
      );
    case 'blog':
      return (
        <svg {...common}>
          <path d="M6 4h9l3 3v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" {...stroke} />
          <path d="M15 4v3h3M8 11h8M8 15h6" {...stroke} />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" {...stroke} />
        </svg>
      );
  }
}

export function HeaderSearchPanel({ open, closing, onClose, onNavigate }: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const transition = useSiteTransition();
  const abortRef = useRef<AbortController | null>(null);

  const [q, setQ] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [retryTick, setRetryTick] = useState(0);
  const panelVisible = open || closing;

  const flatHits = useMemo<FlatHit[]>(
    () =>
      groups.flatMap((g) =>
        g.items.map((item) => ({
          ...item,
          groupLabel: g.label,
          groupKey: g.key,
        })),
      ),
    [groups],
  );

  const goToHref = useCallback(
    (href: string) => {
      window.dispatchEvent(new Event(MENU_COVERED_EVENT));
      onNavigate();
      if (transition && href.startsWith('/') && !href.startsWith('//')) {
        transition.navigateWithTransition(href, true);
      } else {
        window.location.assign(href);
      }
    },
    [onNavigate, transition],
  );

  const clearQuery = useCallback(() => {
    setQ('');
    setGroups([]);
    setSearched(false);
    setLoadError(false);
    setActiveIndex(-1);
    setBusy(false);
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setQ('');
      setGroups([]);
      setSearched(false);
      setLoadError(false);
      setBusy(false);
      setActiveIndex(-1);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      abortRef.current?.abort();
      abortRef.current = null;
      setGroups([]);
      setSearched(false);
      setLoadError(false);
      setBusy(false);
      setActiveIndex(-1);
      return;
    }

    const timer = window.setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setBusy(true);
      setLoadError(false);
      void (async () => {
        try {
          const next = await fetchSearchGroups(trimmed, ac.signal);
          if (ac.signal.aborted) return;
          setGroups(next);
          setSearched(true);
          setLoadError(false);
          setActiveIndex(-1);
        } catch (err) {
          if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
            return;
          }
          setGroups([]);
          setSearched(false);
          setLoadError(true);
          setActiveIndex(-1);
        } finally {
          if (!ac.signal.aborted) setBusy(false);
        }
      })();
    }, 220);

    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [q, open, retryTick]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (q.trim()) {
          clearQuery();
          return;
        }
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const nodes = focusablesIn(panel);
        if (nodes.length === 0) {
          e.preventDefault();
          return;
        }
        const first = nodes[0]!;
        const last = nodes[nodes.length - 1]!;
        if (e.shiftKey) {
          if (document.activeElement === first || !panel.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else if (
          document.activeElement === last ||
          !panel.contains(document.activeElement)
        ) {
          e.preventDefault();
          first.focus();
        }
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (flatHits.length === 0) return;
        e.preventDefault();
        setActiveIndex((prev) => {
          if (e.key === 'ArrowDown') {
            return prev < 0 ? 0 : (prev + 1) % flatHits.length;
          }
          return prev <= 0 ? flatHits.length - 1 : prev - 1;
        });
        return;
      }

      if (e.key === 'Enter') {
        const hit =
          activeIndex >= 0 && flatHits[activeIndex]
            ? flatHits[activeIndex]
            : flatHits[0];
        if (!hit) return;
        e.preventDefault();
        goToHref(hit.href);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, flatHits, activeIndex, goToHref, q, clearQuery]);

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-search-hit-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const totalHits = flatHits.length;
  const hint =
    q.trim().length > 0 && q.trim().length < 2
      ? 'Введите минимум 2 символа'
      : null;
  const showEmpty = searched && !busy && !loadError && totalHits === 0;
  const showError = loadError && !busy;

  let hitOffset = 0;

  return (
    <>
      {panelVisible ? (
        <button
          type="button"
          className={styles.searchScrim}
          aria-label="Закрыть поиск"
          tabIndex={-1}
          onClick={onClose}
        />
      ) : null}
      <div
        id="header-search-panel"
        ref={panelRef}
        className={`${styles.superMenu} ${closing ? styles.superMenuClosing : ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label="Поиск по сайту"
        aria-hidden={!panelVisible}
      >
        <div className={styles.superMenuSlideWrap}>
          <div className={styles.superMenuBg} aria-hidden />
          <button
            type="button"
            className={styles.searchBackdrop}
            aria-label="Закрыть поиск"
            tabIndex={-1}
            onClick={onClose}
          />
          <div className={`${styles.superMenuPanel} ${styles.searchPanel}`}>
          <div className="padding-global">
            <div className={styles.siteHeaderWrap}>
              <div className={styles.searchPanelInner}>
                <div className={styles.searchFieldRow}>
                  <label className={styles.srOnly} htmlFor={inputId}>
                    Поиск по сайту
                  </label>
                  <div className={styles.searchInputWrap}>
                    <input
                      ref={inputRef}
                      id={inputId}
                      type="text"
                      inputMode="search"
                      enterKeyHint="search"
                      className={styles.searchInput}
                      placeholder="Товар, состав, статья или категория"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      aria-autocomplete="list"
                      aria-controls="header-search-results"
                      aria-activedescendant={
                        activeIndex >= 0
                          ? `header-search-hit-${activeIndex}`
                          : undefined
                      }
                    />
                    {q.length > 0 ? (
                      <button
                        type="button"
                        className={styles.searchClearBtn}
                        aria-label="Очистить запрос"
                        onClick={clearQuery}
                      >
                        <ClearIcon />
                      </button>
                    ) : null}
                  </div>
                </div>

                <div
                  id="header-search-results"
                  ref={listRef}
                  className={styles.searchResults}
                  role="listbox"
                  aria-label="Результаты поиска"
                  aria-busy={busy}
                  aria-live="polite"
                >
                  {busy ? (
                    <div className={styles.searchSkeleton} aria-hidden>
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className={styles.searchSkeletonRow}>
                          <span className={styles.searchSkeletonThumb} />
                          <span className={styles.searchSkeletonLines}>
                            <span className={styles.searchSkeletonLine} />
                            <span
                              className={`${styles.searchSkeletonLine} ${styles.searchSkeletonLineShort}`}
                            />
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {hint && !busy ? (
                    <p className={styles.searchMeta}>{hint}</p>
                  ) : null}

                  {showError ? (
                    <div className={styles.searchEmpty}>
                      <p className={styles.searchMeta}>Не удалось загрузить</p>
                      <div className={styles.searchEmptyActions}>
                        <button
                          type="button"
                          className={styles.searchEmptyBtn}
                          onClick={() => setRetryTick((n) => n + 1)}
                        >
                          Повторить
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {showEmpty ? (
                    <div className={styles.searchEmpty}>
                      <p className={styles.searchMeta}>Ничего не найдено</p>
                      <div className={styles.searchEmptyActions}>
                        <button
                          type="button"
                          className={styles.searchEmptyBtn}
                          onClick={clearQuery}
                        >
                          Сбросить
                        </button>
                        <TransitionLink
                          href="/catalog"
                          className={styles.searchEmptyLink}
                          fromMenu
                          onClick={() => {
                            window.dispatchEvent(new Event(MENU_COVERED_EVENT));
                            onNavigate();
                          }}
                        >
                          В каталог
                        </TransitionLink>
                        <TransitionLink
                          href="/blog"
                          className={styles.searchEmptyLink}
                          fromMenu
                          onClick={() => {
                            window.dispatchEvent(new Event(MENU_COVERED_EVENT));
                            onNavigate();
                          }}
                        >
                          В блог
                        </TransitionLink>
                      </div>
                    </div>
                  ) : null}

                  {!busy
                    ? groups.map((group) => {
                        const offset = hitOffset;
                        hitOffset += group.items.length;
                        return (
                          <section key={group.key} className={styles.searchGroup}>
                            <h2 className={styles.searchGroupLabel}>{group.label}</h2>
                            <ul className={styles.searchHitList} role="presentation">
                              {group.items.map((hit, i) => {
                                const index = offset + i;
                                const active = index === activeIndex;
                                return (
                                  <li key={`${group.key}-${hit.id}`} role="presentation">
                                    <TransitionLink
                                      id={`header-search-hit-${index}`}
                                      href={hit.href}
                                      className={`${styles.searchHit} ${active ? styles.searchHitActive : ''}`.trim()}
                                      fromMenu
                                      role="option"
                                      aria-selected={active}
                                      data-search-hit-index={index}
                                      onMouseEnter={() => setActiveIndex(index)}
                                      onClick={() => {
                                        window.dispatchEvent(new Event(MENU_COVERED_EVENT));
                                        onNavigate();
                                      }}
                                    >
                                      {hit.imageUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={hit.imageUrl}
                                          alt=""
                                          className={styles.searchHitImg}
                                        />
                                      ) : (
                                        <span className={styles.searchHitPh} aria-hidden>
                                          <HitGlyph type={group.key} />
                                        </span>
                                      )}
                                      <span className={styles.searchHitText}>
                                        <span className={styles.searchHitTitle}>{hit.title}</span>
                                        {hit.subtitle ? (
                                          <span className={styles.searchHitSub}>
                                            {hit.subtitle}
                                          </span>
                                        ) : null}
                                      </span>
                                    </TransitionLink>
                                  </li>
                                );
                              })}
                            </ul>
                          </section>
                        );
                      })
                    : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
