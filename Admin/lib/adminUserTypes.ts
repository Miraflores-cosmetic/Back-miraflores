export type AdminRetailUser = {
  id: string;
  email: string;
  displayName: string | null;
  isActive: boolean;
  createdAt: string;
  orderCount: number;
};

export type AdminRetailUserListResponse = {
  items: AdminRetailUser[];
  total: number;
  page: number;
  limit: number;
};

export type AdminRetailUserOrder = {
  id: string;
  number: string;
  status: string;
  total: number;
  createdAt: string;
};

export type AdminRetailUserAddress = {
  id: string;
  recipientName: string | null;
  phone: string | null;
  city: string;
  address: string;
  apartment: string | null;
  region: string | null;
  district: string | null;
  postalCode: string | null;
  comment: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminRetailUserGroup = {
  id: string;
  name: string;
  slug: string;
  assignable: boolean;
};

export type AdminRetailUserDetail = AdminRetailUser & {
  groupId: string | null;
  group: AdminRetailUserGroup | null;
  phone: string | null;
  birthday: string | null;
  marketingConsent: boolean;
  marketingConsentAt: string | null;
  privacyConsentAt: string | null;
  updatedAt: string;
  addresses: AdminRetailUserAddress[];
  orders: AdminRetailUserOrder[];
  ordersTotal: number;
  ordersPage: number;
  ordersLimit: number;
  quiz: AdminRetailUserQuiz;
};

export type AdminRetailUserQuizSaved = {
  version: number;
  zone: string;
  completedAt: string;
  updatedAt: string;
  answers: {
    skin_age?: string | null;
    spf?: string | null;
    swelling?: string | null;
    skin_issues?: string[];
    skin_tasks?: string[];
    selfie_count?: number;
    [key: string]: unknown;
  };
  result: {
    priority: number | null;
    blockKeys: string[];
  };
};

export type AdminRetailUserQuizFunnelStep = {
  key: string;
  label: string;
  zone: string | null;
  viewed: boolean;
  completed: boolean;
};

export type AdminRetailUserQuiz = {
  saved: AdminRetailUserQuizSaved | null;
  funnel: AdminRetailUserQuizFunnelStep[];
  stats: {
    eventsCount: number;
    sessionsCount: number;
    lastActivityAt: string | null;
    lastZone: string | null;
    lastCompleteBlockKeys: string[];
    lastCompletePriority: number | null;
  };
};
