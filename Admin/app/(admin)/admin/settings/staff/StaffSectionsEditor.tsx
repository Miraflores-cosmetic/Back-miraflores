'use client';

import { AdminCheckbox } from '@/components/admin/AdminCheckbox/AdminCheckbox';
import { AdminCompactBtn } from '@/components/AdminCompactBtn/AdminCompactBtn';
import type { ModeratorAssignableSectionId } from '@/lib/adminSections';
import {
  sectionsMissingCatalogHint,
  sectionsMissingCertificatesCatalogHint,
  sectionsMissingFulfillmentHint,
} from '@/lib/adminSections';
import type { StaffSectionCatalogItem } from '@/lib/adminStaffTypes';
import catalogStyles from '@/app/(admin)/admin/catalog/catalogAdmin.module.css';
import styles from './staffAdmin.module.css';

export type StaffSectionsEditorProps = {
  catalog: StaffSectionCatalogItem[];
  sections: ModeratorAssignableSectionId[];
  onSectionsChange: (sections: ModeratorAssignableSectionId[]) => void;
};

export function StaffSectionsEditor({
  catalog,
  sections,
  onSectionsChange,
}: StaffSectionsEditorProps) {
  function toggleSection(id: ModeratorAssignableSectionId) {
    onSectionsChange(
      sections.includes(id)
        ? sections.length <= 1
          ? sections
          : sections.filter((x) => x !== id)
        : [...sections, id],
    );
  }

  function selectAll() {
    onSectionsChange(catalog.map((item) => item.id));
  }

  function resetToFirst() {
    if (catalog[0]) onSectionsChange([catalog[0].id]);
  }

  return (
    <div className={styles.formSection}>
      <div className={styles.listHeader}>
        <h2 className={`${catalogStyles.groupHeading} ${styles.panelHeading}`}>Разделы</h2>
        <div className={catalogStyles.bulkGroup}>
          <AdminCompactBtn type="button" onClick={selectAll}>
            Все
          </AdminCompactBtn>
          <AdminCompactBtn
            type="button"
            onClick={resetToFirst}
            disabled={sections.length <= 1}
          >
            Сбросить
          </AdminCompactBtn>
        </div>
      </div>
      <div className={styles.profileFormFields}>
        {catalog.map((item) => {
          const inputId = `staff-section-${item.id}`;
          return (
            <label key={item.id} className={catalogStyles.labelCheckboxRow} htmlFor={inputId}>
              <AdminCheckbox
                id={inputId}
                checked={sections.includes(item.id)}
                disabled={sections.includes(item.id) && sections.length <= 1}
                onChange={() => toggleSection(item.id)}
              />
              {item.label}
            </label>
          );
        })}
      </div>
      {sectionsMissingCatalogHint(sections).length > 0 ? (
        <p className={catalogStyles.lead} style={{ marginTop: 12 }}>
          Для «Скидки и промо», разделов сертификатов и «Отзывы» пикеры товаров/категорий
          ходят в API каталога. Без раздела «Каталог» UI откроется, но запросы вернут 403 —
          добавьте «Каталог» или уберите эти разделы.
        </p>
      ) : null}
      {sectionsMissingFulfillmentHint(sections).length > 0 ? (
        <p className={catalogStyles.lead} style={{ marginTop: 12 }}>
          «Заказы: оплата и возвраты» — mark-paid / refund и пункт «Заказы» в меню. Без
          раздела «Заказы» недоступны packing и остальной фулфилмент — добавьте «Заказы» или
          снимите finance-grant.
        </p>
      ) : null}
      {sectionsMissingCertificatesCatalogHint(sections).length > 0 ? (
        <p className={catalogStyles.lead} style={{ marginTop: 12 }}>
          «Сертификаты: выпуск и операции» — issue / revoke / adjust. Без «Сертификаты:
          номиналы и список» нельзя создавать и править номиналы (GET для выпуска всё равно
          доступен).
        </p>
      ) : null}
    </div>
  );
}
