import { BadGatewayException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OZON_UNAVAILABLE_MESSAGE } from './ozon-auth.service';
import { OzonPublicController } from './ozon.public.controller';

function controller(opts: { connected: boolean[]; nearby: () => Promise<unknown[]> }) {
  const connected = [...opts.connected];
  const auth = {
    isConnected: vi.fn(async () => (connected.length > 1 ? connected.shift()! : connected[0])),
  };
  const points = { nearby: vi.fn(opts.nearby) };
  return {
    ctrl: new OzonPublicController(points as never, auth as never, { get: () => undefined } as never),
    points,
  };
}

const query = { lat: 55.75, lon: 37.61 };

describe('OzonPublicController graceful degradation', () => {
  it('не подключён: availability=false и pickup-points 200 без обращения к Ozon', async () => {
    const { ctrl, points } = controller({ connected: [false], nearby: async () => [] });
    await expect(ctrl.availability()).resolves.toEqual({
      available: false,
      message: OZON_UNAVAILABLE_MESSAGE,
    });
    await expect(ctrl.pickupPoints(query as never)).resolves.toMatchObject({
      available: false,
      degraded: false,
      points: [],
      message: OZON_UNAVAILABLE_MESSAGE,
    });
    expect(points.nearby).not.toHaveBeenCalled();
  });

  it('подключён: отдаёт точки', async () => {
    const { ctrl } = controller({ connected: [true], nearby: async () => [{ id: '1' }] });
    await expect(ctrl.pickupPoints(query as never)).resolves.toMatchObject({
      available: true,
      degraded: false,
      points: [{ id: '1' }],
      message: null,
    });
  });

  it('Ozon API упал: 200 degraded вместо 502', async () => {
    const { ctrl } = controller({
      connected: [true],
      nearby: async () => {
        throw new BadGatewayException('Ozon: не удалось получить пункты выдачи');
      },
    });
    const res = await ctrl.pickupPoints(query as never);
    expect(res).toMatchObject({ available: true, degraded: true, points: [] });
    expect(res.message).toMatch(/Не удалось загрузить пункты выдачи Ozon/);
  });

  it('refresh token отозван во время запроса: available=false', async () => {
    const { ctrl } = controller({
      connected: [true, false],
      nearby: async () => {
        throw new Error('invalid_grant');
      },
    });
    await expect(ctrl.pickupPoints(query as never)).resolves.toMatchObject({
      available: false,
      degraded: false,
      message: OZON_UNAVAILABLE_MESSAGE,
    });
  });
});
