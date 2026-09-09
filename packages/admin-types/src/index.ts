import type {
  AdminSectionId,
  ModeratorAssignableSectionId,
} from '@miraflores/admin-sections';

export type StaffRole = 'ADMIN' | 'MODERATOR';

export type StaffContext = {
  isSuperAdmin: boolean;
  sections: AdminSectionId[];
  staffDisplayName: string | null;
  staffAvatarUrl: string | null;
};

export type StaffAdminRow = {
  id: string;
  email: string | null;
  role: StaffRole;
  isActive: boolean;
  staffDisplayName: string | null;
  staffAvatarUrl: string | null;
  adminSections: ModeratorAssignableSectionId[];
  lastAdminLoginAt: string | null;
  createdAt: string;
};

export type StaffSectionCatalogItem = {
  id: ModeratorAssignableSectionId;
  label: string;
};

export type CreateStaffResponse = {
  user: StaffAdminRow;
  emailSent: boolean;
  temporaryPassword?: string;
};

export type ResetStaffPasswordResponse = {
  emailSent: boolean;
  temporaryPassword?: string;
};

/** Preset «Контент» при создании модератора (blog + reviews). */
export const MODERATOR_CREATE_PRESET_CONTENT: readonly ModeratorAssignableSectionId[] = [
  'blog',
  'reviews',
];

export {
  PRODUCT_ATTRIBUTE_KINDS,
  PRODUCT_ATTRIBUTE_KIND_LABELS,
  isProductAttributeKind,
  type ProductAttributeKind,
} from './productAttributes';
