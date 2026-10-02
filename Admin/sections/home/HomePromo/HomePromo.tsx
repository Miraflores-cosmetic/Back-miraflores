'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PublicHomePromoBanner } from '@/lib/homePromoPublicServer';
import styles from './HomePromo.module.css';

function fanStyle(index: number, total: number): CSSProperties {
  const t = total <= 1 ? 1 : index / (total - 1);
  const fan = 38 - t * 24;
  const x = -82 + t * 160;
  const z = -100 + t * 170;
  const scale = 0.94 + t * 0.12;
  return {
    ['--fan' as string]: `${fan}deg`,
    ['--x' as string]: `${x}%`,
    ['--z' as string]: `${z}px`,
    ['--scale' as string]: String(scale),
    ['--delay' as string]: `${0.08 + index * 0.08}s`,
    zIndex: index + 1,
  };
}

export function HomePromo({
  titleLeft,
  titleRight,
  items,
}: {
  titleLeft: string;
  titleRight: string;
  items: PublicHomePromoBanner[];
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  const activeRef = useRef<number | null>(null);
  const lockUntilRef = useRef(0);
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const commitActive = useCallback((next: number | null) => {
    if (next === activeRef.current) return;
    activeRef.current = next;
    setActive(next);
    if (next != null) {
      lockUntilRef.current = performance.now() + 420;
    }
  }, []);

  function resolveActive(clientX: number, clientY: number) {
    if (performance.now() < lockUntilRef.current && activeRef.current != null) {
      return;
    }
    let best: number | null = null;
    let bestDist = Infinity;
    cardRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) {
        return;
      }
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = (clientX - cx) ** 2 + (clientY - cy) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    commitActive(best);
  }

  function clearActive() {
    lockUntilRef.current = 0;
    commitActive(null);
  }

  if (!items.length) return null;

  const label = `${titleLeft} ${titleRight}`.trim() || 'Промо';

  return (
    <section
      ref={rootRef}
      className={[
        styles.section,
        visible ? styles.visible : '',
        active != null ? styles.stackHovered : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
    >
      <div className={styles.stage}>
        <p className={`${styles.word} ${styles.wordLeft}`} aria-hidden>
          {titleLeft}
        </p>

        <div
          className={[styles.stack, active != null ? styles.stackActive : '']
            .filter(Boolean)
            .join(' ')}
          onMouseMove={(e) => resolveActive(e.clientX, e.clientY)}
          onMouseLeave={clearActive}
        >
          {items.map((card, index) => {
            const isActive = active === index;
            const isPushed = active != null && index > active;
            const pushSteps = isPushed && active != null ? index - active : 0;
            const base = fanStyle(index, items.length);
            const remote = /^https?:\/\//i.test(card.imageUrl);

            const className = [
              styles.card,
              card.notch ? styles.cardNotch : '',
              isActive ? styles.cardActive : '',
            ]
              .filter(Boolean)
              .join(' ');

            const style = {
              ...base,
              ...(isActive
                ? {
                    ['--fan' as string]: '0deg',
                    ['--z' as string]: '240px',
                    ['--scale' as string]: '1.08',
                    ['--push' as string]: '0%',
                  }
                : {
                    ['--push' as string]: isPushed ? `${pushSteps * 10}%` : '0%',
                  }),
              zIndex: isActive ? 16 : isPushed ? 5 + index : (base.zIndex as number),
            } as CSSProperties;

            return (
              <Link
                key={card.id}
                ref={(node) => {
                  cardRefs.current[index] = node;
                }}
                href={card.href || '/catalog'}
                className={className}
                style={style}
                aria-label={card.alt || label}
                onFocus={() => commitActive(index)}
                onBlur={clearActive}
              >
                <Image
                  src={card.imageUrl}
                  alt=""
                  fill
                  className={styles.cardImg}
                  sizes="(max-width: 1024px) 42vw, 532px"
                  unoptimized={remote}
                />
              </Link>
            );
          })}
        </div>

        <p className={`${styles.word} ${styles.wordRight}`} aria-hidden>
          {titleRight}
        </p>
      </div>

      <div className={styles.mobileStage}>
        <div className={styles.mobileStrip} role="list" aria-label={label}>
          {items.map((card) => {
            const remote = /^https?:\/\//i.test(card.imageUrl);
            return (
              <Link
                key={card.id}
                href={card.href || '/catalog'}
                className={[styles.mobileCard, card.notch ? styles.cardNotch : '']
                  .filter(Boolean)
                  .join(' ')}
                aria-label={card.alt || label}
                role="listitem"
              >
                <Image
                  src={card.imageUrl}
                  alt={card.alt || ''}
                  fill
                  className={styles.mobileCardImg}
                  sizes="260px"
                  unoptimized={remote}
                />
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
