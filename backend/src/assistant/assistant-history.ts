import type { GptMessage, GptToolCall } from './gptunnel.client';

export type AssistantDbMessage = {
  role: string;
  content: string;
  meta: unknown;
};

/** Human-readable status while a tool runs (never raw tool name). */
export function assistantToolStatusMessage(toolName: string): string {
  switch (toolName) {
    case 'get_dashboard_overview':
      return 'Смотрю сводку дашборда…';
    case 'list_orders':
      return 'Смотрю заказы…';
    case 'search_products':
      return 'Ищу товары в каталоге…';
    case 'list_oos_variants':
      return 'Проверяю товары без наличия…';
    case 'sales_timeseries':
      return 'Строю динамику продаж по дням…';
    case 'compare_periods':
      return 'Сравниваю периоды…';
    case 'top_products':
      return 'Считаю топ товаров…';
    case 'funnel_lite':
      return 'Смотрю воронку статусов заказов…';
    case 'content_gaps':
      return 'Ищу пробелы в контенте…';
    case 'list_user_groups':
      return 'Смотрю группы пользователей…';
    case 'get_user_group':
      return 'Загружаю настройки группы…';
    case 'list_discounts':
      return 'Смотрю кампании Discount…';
    case 'get_discount':
      return 'Загружаю кампанию Discount…';
    case 'list_promo_codes':
      return 'Смотрю промокоды…';
    case 'get_promo_code':
      return 'Загружаю промокод…';
    case 'list_catalog_visibility':
      return 'Смотрю правила видимости…';
    default:
      return 'Смотрю данные…';
  }
}

function metaToolCalls(meta: unknown): GptToolCall[] | null {
  if (!meta || typeof meta !== 'object') return null;
  const toolCalls = (meta as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
  return toolCalls as GptToolCall[];
}

/** UI / resume: only user turns and final assistant replies (no tool stubs). */
export function isAssistantUiHistoryMessage(m: AssistantDbMessage): boolean {
  if (m.role === 'user') return true;
  if (m.role !== 'assistant') return false;
  if (metaToolCalls(m.meta)) return false;
  return m.content.trim().length > 0;
}

/**
 * Build model context from DB history without past tool JSON / tool_call stubs.
 * Current-turn tools are appended in-memory during the agent loop.
 */
export function dbHistoryToModelMessages(
  systemPrompt: string,
  history: readonly AssistantDbMessage[],
): GptMessage[] {
  const messages: GptMessage[] = [{ role: 'system', content: systemPrompt }];
  for (const m of history) {
    if (m.role === 'user') {
      messages.push({ role: 'user', content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      if (metaToolCalls(m.meta)) continue;
      const text = m.content.trim();
      if (!text) continue;
      messages.push({ role: 'assistant', content: text });
    }
    // skip role=tool and anything else
  }
  return messages;
}
