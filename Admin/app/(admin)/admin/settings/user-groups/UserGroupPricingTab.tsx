'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { AdminTabs } from '@/components/AdminTabs/AdminTabs';
import type { AdminUserGroup } from '@/lib/adminUserGroupTypes';
import {
  parseUserGroupPricingSection,
  type UserGroupPricingSection,
} from '@/lib/userGroupPricing';
import { UserGroupCategoryPricesTab } from './UserGroupCategoryPricesTab';
import { UserGroupProductPricesTab } from './UserGroupProductPricesTab';

type Props = {
  groupId: string;
  group: AdminUserGroup;
  onChanged: () => void;
};

export function UserGroupPricingTab({ groupId, group, onChanged }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const section = parseUserGroupPricingSection(searchParams.get('section'));

  const setSection = useCallback(
    (next: UserGroupPricingSection) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set('tab', 'prices');
      if (next === 'categories') sp.delete('section');
      else sp.set('section', next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <>
      <AdminTabs
        ariaLabel="Тип ценовых правил"
        variant="pill"
        compact
        activeId={section}
        onChange={(id) => setSection(id as UserGroupPricingSection)}
        items={[
          { id: 'categories', label: `Категории (${group.counts.categoryPrices})` },
          { id: 'products', label: `Товары (${group.counts.variantPrices})` },
        ]}
      />
      {section === 'categories' ? (
        <UserGroupCategoryPricesTab groupId={groupId} onChanged={onChanged} />
      ) : (
        <UserGroupProductPricesTab
          groupId={groupId}
          priceRounding={group.priceRounding}
          totalCount={group.counts.variantPrices}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
