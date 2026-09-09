export type VisibilityMode =
  | 'HIDE_FROM_GUESTS'
  | 'HIDE_FROM_REGISTERED'
  | 'HIDE_FROM_GROUP'
  | 'SHOW_ONLY_REGISTERED'
  | 'SHOW_ONLY_GROUP';

export type VisibilityTargetType = 'PRODUCT' | 'CATEGORY' | 'VARIANT';

export const VISIBILITY_MODE_LABELS: Record<VisibilityMode, string> = {
  HIDE_FROM_GUESTS: 'Скрыть от гостей',
  HIDE_FROM_REGISTERED: 'Скрыть от зарег.',
  HIDE_FROM_GROUP: 'Скрыть от группы',
  SHOW_ONLY_REGISTERED: 'Только зарег.',
  SHOW_ONLY_GROUP: 'Только группа',
};

export const VISIBILITY_TARGET_LABELS: Record<VisibilityTargetType, string> = {
  PRODUCT: 'Товар',
  CATEGORY: 'Категория',
  VARIANT: 'Вариант',
};

export const VISIBILITY_MODE_HELP: Record<
  VisibilityMode,
  { summary: string; example: string; kind: 'hide' | 'show' }
> = {
  HIDE_FROM_GUESTS: {
    kind: 'hide',
    summary: 'Объект не видят гости (без входа). Зарегистрированные — видят.',
    example: 'Пример: оптовая линейка только после login.',
  },
  HIDE_FROM_REGISTERED: {
    kind: 'hide',
    summary: 'Объект не видят все залогиненные. Гости — видят.',
    example: 'Пример: акция «только для гостей» на карточке.',
  },
  HIDE_FROM_GROUP: {
    kind: 'hide',
    summary: 'Скрыто для участников этой группы; остальные контексты — видят.',
    example: 'Пример: SKU недоступен вашим B2B-клиентам, но виден гостям.',
  },
  SHOW_ONLY_REGISTERED: {
    kind: 'show',
    summary: 'Whitelist: объект видят только залогиненные (любая группа).',
    example: 'Пример: закрытый SKU — гость не найдёт в каталоге.',
  },
  SHOW_ONLY_GROUP: {
    kind: 'show',
    summary: 'Whitelist: объект видят только участники этой группы.',
    example: 'Пример: эксклюзив для группы «Дилеры».',
  },
};

/** Краткий preview «кто видит» для одного правила (без учёта других правил на объект). */
export function visibilityAudiencePreview(mode: string, groupName: string): string {
  switch (mode as VisibilityMode) {
    case 'HIDE_FROM_GUESTS':
      return 'Видят: зарегистрированные · не видят: гости';
    case 'HIDE_FROM_REGISTERED':
      return 'Видят: гости · не видят: зарегистрированные';
    case 'HIDE_FROM_GROUP':
      return `Не видят: «${groupName}» · видят: остальные`;
    case 'SHOW_ONLY_REGISTERED':
      return 'Видят: зарегистрированные · не видят: гости';
    case 'SHOW_ONLY_GROUP':
      return `Видят: только «${groupName}» · не видят: гости и другие группы`;
    default:
      return '—';
  }
}

export const VISIBILITY_CONFLICT_HINT =
  'Несколько правил на один объект комбинируются: whitelist (Только…) сужает аудиторию, скрытие — вычитает. При сомнении проверьте на витрине под гостем, розницей или группой.';
