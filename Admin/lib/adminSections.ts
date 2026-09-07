/** Реэкспорт единого ACL-пакета (явные имена — webpack/CJS interop с `export *`). */
export {
  ADMIN_SECTION_DASHBOARD,
  ADMIN_SECTION_IDS,
  ADMIN_SECTION_LABELS_RU,
  ALL_STAFF_SECTIONS_WITH_DASHBOARD,
  MODERATOR_ASSIGNABLE_SECTIONS,
  SECTIONS_NEEDING_CATALOG,
  SECTIONS_NEEDING_CERTIFICATES_CATALOG,
  SECTIONS_NEEDING_FULFILLMENT,
  SECTIONS_NEEDING_ORDERS,
  isAdminSectionId,
  normalizeStoredAdminSections,
  resolveAdminSectionFromApiPath,
  resolveAdminSectionFromPathname,
  sectionsMissingCatalogHint,
  sectionsMissingCertificatesCatalogHint,
  sectionsMissingFulfillmentHint,
  sectionsMissingOrdersHint,
  staffCanAccessAdminPath,
  staffCanAccessCertificatesUi,
  staffCanAssistant,
  staffCanCertificatesCatalog,
  staffCanCertificatesFinance,
  staffCanOrdersFinance,
  staffCanSeeCertificatesNav,
  isAllowedAdminBackendPath,
} from '@miraflores/admin-sections';

export type {
  AdminPathAccessTarget,
  AdminSectionId,
  ModeratorAssignableSectionId,
} from '@miraflores/admin-sections';
