/** Shared types for admin reviews UI. */

export type AdminReviewStatusFilter = 'all' | 'pending' | 'published' | 'rejected';

export type AdminReviewProductRef = {
  id: string;
  name: string;
  slug: string;
};

export type AdminReviewUserRef = {
  id: string;
  email: string;
  displayName: string | null;
};

export type AdminReviewRow = {
  id: string;
  productId: string;
  product: AdminReviewProductRef;
  userId: string | null;
  user: AdminReviewUserRef | null;
  orderId: string | null;
  rating: number;
  text: string;
  authorName: string | null;
  image1Url: string | null;
  image2Url: string | null;
  isPublished: boolean;
  sortOrder?: number;
  moderatedById: string | null;
  moderatedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminReviewCounts = {
  all: number;
  pending: number;
  published: number;
  rejected: number;
};

export type AdminReviewListResponse = {
  items: AdminReviewRow[];
  total: number;
  page: number;
  limit: number;
  counts: AdminReviewCounts;
};

export function parseReviewStatusFilter(raw: string | null): AdminReviewStatusFilter {
  if (raw === 'pending' || raw === 'published' || raw === 'all' || raw === 'rejected') {
    return raw;
  }
  return 'pending';
}

export function reviewAuthorLabel(r: Pick<AdminReviewRow, 'authorName' | 'user'>): string {
  return (
    r.authorName?.trim() ||
    r.user?.displayName?.trim() ||
    r.user?.email ||
    '—'
  );
}

export function reviewModerationLabel(r: AdminReviewRow): string {
  if (r.rejectedAt) return 'Отклонён';
  if (r.isPublished) return 'Опубликован';
  return 'На модерации';
}
