'use client';

import { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import { AdminTabs } from '@/components/AdminTabs/AdminTabs';
import tabStyles from '@/components/AdminTabs/AdminTabs.module.css';
import { CertificateListClient } from './CertificateListClient';
import { CertificateIssueClient } from './issue/CertificateIssueClient';
import { DenominationListClient } from './denominations/DenominationListClient';
import styles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';

export type CertificatesHubTab = 'list' | 'issue' | 'denoms';

function parseTab(
  raw: string | null,
  allowed: readonly CertificatesHubTab[],
): CertificatesHubTab {
  if (raw === 'issue' || raw === 'denoms' || raw === 'list') {
    if (allowed.includes(raw)) return raw;
  }
  return allowed[0] ?? 'list';
}

export function CertificatesHubClient({
  canCertificatesCatalog,
  canCertificatesFinance,
}: {
  canCertificatesCatalog: boolean;
  canCertificatesFinance: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [createDenomOpen, setCreateDenomOpen] = useState(false);

  const tabItems = useMemo(() => {
    const items: { id: CertificatesHubTab; label: string }[] = [
      { id: 'list', label: 'Список' },
    ];
    if (canCertificatesFinance) items.push({ id: 'issue', label: 'Выпуск' });
    if (canCertificatesCatalog) items.push({ id: 'denoms', label: 'Номиналы' });
    return items;
  }, [canCertificatesCatalog, canCertificatesFinance]);

  const allowedTabs = useMemo(
    () => tabItems.map((t) => t.id),
    [tabItems],
  );

  const tab = useMemo(
    () => parseTab(searchParams.get('tab'), allowedTabs),
    [searchParams, allowedTabs],
  );
  const denomsTab = tab === 'denoms';

  const setTab = useCallback(
    (next: CertificatesHubTab) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next === 'list') sp.delete('tab');
      else sp.set('tab', next);
      const q = sp.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
      if (next !== 'denoms') setCreateDenomOpen(false);
    },
    [pathname, router, searchParams],
  );

  return (
    <>
      <h1 className={styles.title}>Сертификаты</h1>
      <AdminTabs
        ariaLabel="Разделы сертификатов"
        variant="underline"
        compact
        activeId={tab}
        onChange={(id) => setTab(id as CertificatesHubTab)}
        items={tabItems}
        end={
          canCertificatesCatalog ? (
            <span className={denomsTab ? undefined : tabStyles.endSlotHidden}>
              <AdminCompactBtn
                type="button"
                variant="accent"
                onClick={() => setCreateDenomOpen(true)}
                tabIndex={denomsTab ? 0 : -1}
                aria-hidden={!denomsTab}
              >
                Создать
              </AdminCompactBtn>
            </span>
          ) : undefined
        }
      />
      {tab === 'list' ? <CertificateListClient /> : null}
      {tab === 'issue' && canCertificatesFinance ? (
        <CertificateIssueClient
          onGoToDenoms={
            canCertificatesCatalog ? () => setTab('denoms') : undefined
          }
        />
      ) : null}
      {tab === 'denoms' && canCertificatesCatalog ? (
        <DenominationListClient
          createOpen={createDenomOpen}
          onCreateOpenChange={setCreateDenomOpen}
        />
      ) : null}
    </>
  );
}
