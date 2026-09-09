import { describe, expect, it } from 'vitest';
import {
  assistantToolStatusMessage,
  dbHistoryToModelMessages,
  isAssistantUiHistoryMessage,
} from './assistant-history';

describe('assistantToolStatusMessage', () => {
  it('возвращает человеческие фразы', () => {
    expect(assistantToolStatusMessage('get_dashboard_overview')).toBe(
      'Смотрю сводку дашборда…',
    );
    expect(assistantToolStatusMessage('list_orders')).toBe('Смотрю заказы…');
    expect(assistantToolStatusMessage('search_products')).toBe(
      'Ищу товары в каталоге…',
    );
    expect(assistantToolStatusMessage('list_oos_variants')).toBe(
      'Проверяю товары без наличия…',
    );
    expect(assistantToolStatusMessage('sales_timeseries')).toBe(
      'Строю динамику продаж по дням…',
    );
    expect(assistantToolStatusMessage('compare_periods')).toBe(
      'Сравниваю периоды…',
    );
    expect(assistantToolStatusMessage('top_products')).toBe('Считаю топ товаров…');
    expect(assistantToolStatusMessage('funnel_lite')).toBe(
      'Смотрю воронку статусов заказов…',
    );
    expect(assistantToolStatusMessage('content_gaps')).toBe(
      'Ищу пробелы в контенте…',
    );
    expect(assistantToolStatusMessage('list_user_groups')).toBe(
      'Смотрю группы пользователей…',
    );
    expect(assistantToolStatusMessage('get_user_group')).toBe(
      'Загружаю настройки группы…',
    );
    expect(assistantToolStatusMessage('list_discounts')).toBe(
      'Смотрю кампании Discount…',
    );
    expect(assistantToolStatusMessage('get_promo_code')).toBe('Загружаю промокод…');
    expect(assistantToolStatusMessage('list_catalog_visibility')).toBe(
      'Смотрю правила видимости…',
    );
    expect(assistantToolStatusMessage('unknown_tool')).toBe('Смотрю данные…');
  });
});

describe('dbHistoryToModelMessages', () => {
  it('не отправляет tool JSON и stubs с tool_calls', () => {
    const messages = dbHistoryToModelMessages('SYS', [
      { role: 'user', content: 'Сколько заказов?', meta: null },
      {
        role: 'assistant',
        content: '',
        meta: {
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'get_dashboard_overview', arguments: '{}' },
            },
          ],
        },
      },
      {
        role: 'tool',
        content: '{"ordersCount":12,"revenue":100000}',
        meta: { tool_call_id: 'c1', name: 'get_dashboard_overview' },
      },
      { role: 'assistant', content: 'Сегодня 12 заказов.', meta: null },
      { role: 'user', content: 'А топ?', meta: null },
    ]);

    expect(messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'Сколько заказов?' },
      { role: 'assistant', content: 'Сегодня 12 заказов.' },
      { role: 'user', content: 'А топ?' },
    ]);
    expect(JSON.stringify(messages)).not.toContain('ordersCount');
    expect(JSON.stringify(messages)).not.toContain('tool_calls');
  });
});

describe('isAssistantUiHistoryMessage', () => {
  it('фильтрует stubs и tool', () => {
    expect(
      isAssistantUiHistoryMessage({
        role: 'user',
        content: 'hi',
        meta: null,
      }),
    ).toBe(true);
    expect(
      isAssistantUiHistoryMessage({
        role: 'assistant',
        content: 'Ответ',
        meta: null,
      }),
    ).toBe(true);
    expect(
      isAssistantUiHistoryMessage({
        role: 'assistant',
        content: '',
        meta: { tool_calls: [{ id: '1' }] },
      }),
    ).toBe(false);
    expect(
      isAssistantUiHistoryMessage({
        role: 'tool',
        content: '{}',
        meta: null,
      }),
    ).toBe(false);
  });
});
