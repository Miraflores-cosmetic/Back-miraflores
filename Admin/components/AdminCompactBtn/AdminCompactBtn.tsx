import { forwardRef } from 'react';
import Link from 'next/link';
import styles from './AdminCompactBtn.module.css';

export type AdminCompactBtnVariant = 'neutral' | 'accent' | 'danger' | 'outline';

export type AdminCompactBtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: React.ReactNode;
  variant?: AdminCompactBtnVariant;
};

const VARIANT_CLASS: Record<AdminCompactBtnVariant, string> = {
  neutral: 'btnNeutral',
  accent: 'btnAccent',
  danger: 'btnDanger',
  outline: 'btnOutline',
};

function compactBtnClass(variant: AdminCompactBtnVariant, className?: string, asLink?: boolean) {
  const variantClass = styles[VARIANT_CLASS[variant]];
  return `${styles.btn} ${asLink ? styles.btnAsLink : ''} ${variantClass} ${className ?? ''}`.trim();
}

/** Компактная кнопка админки: h-28, caption, заливка neutral, accent или danger. */
export const AdminCompactBtn = forwardRef<HTMLButtonElement, AdminCompactBtnProps>(
  function AdminCompactBtn(
    { children, className, type = 'button', variant = 'neutral', ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={compactBtnClass(variant, className)}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

export type AdminCompactBtnLinkProps = React.ComponentProps<typeof Link> & {
  children: React.ReactNode;
  variant?: AdminCompactBtnVariant;
};

/** Компактная ссылка в стиле AdminCompactBtn. */
export function AdminCompactBtnLink({
  children,
  className,
  variant = 'neutral',
  ...rest
}: AdminCompactBtnLinkProps) {
  return (
    <Link className={compactBtnClass(variant, className, true)} {...rest}>
      {children}
    </Link>
  );
}
