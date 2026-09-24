import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { flushAfterRlsCommit } from '../rls/rls-after-commit';
import type { RlsCtx } from '../rls/rls-after-commit';
import { rlsAls } from '../rls/rls-context';

/**
 * Prisma + PostgreSQL RLS.
 * Внутри runInRlsTransaction делегирует модель-доступ в tx с set_config(..., is_local).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    const base = this;

    // eslint-disable-next-line no-constructor-return -- Proxy для RLS tx affinity
    return new Proxy(base, {
      get(target, prop, receiver) {
        if (
          prop === 'runInRlsTransaction' ||
          prop === 'onModuleInit' ||
          prop === 'onModuleDestroy'
        ) {
          const val = Reflect.get(target, prop, receiver) as unknown;
          if (typeof val === 'function') {
            return (...args: unknown[]) =>
              (val as (...a: unknown[]) => unknown).apply(target, args);
          }
          return val;
        }

        const store = rlsAls.getStore();

        if (prop === '$transaction') {
          if (store?.tx) {
            return (arg: unknown) => {
              if (typeof arg === 'function') {
                return (arg as (tx: Prisma.TransactionClient) => unknown)(store.tx);
              }
              if (Array.isArray(arg)) {
                return Promise.all(arg as Promise<unknown>[]);
              }
              return target.$transaction.bind(target)(arg as never);
            };
          }
          return target.$transaction.bind(target);
        }

        if (store?.tx && typeof prop === 'string' && prop in store.tx) {
          const val = Reflect.get(store.tx, prop);
          return typeof val === 'function' ? val.bind(store.tx) : val;
        }

        return Reflect.get(target, prop, receiver);
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Открывает транзакцию, выставляет RLS GUCs, выполняет fn в ALS.
   * Proxy биндит метод на target (голый PrismaClient), поэтому $transaction — корневой.
   */
  async runInRlsTransaction<T>(ctx: RlsCtx, fn: () => Promise<T>): Promise<T> {
    if (rlsAls.getStore()) {
      return fn();
    }

    const afterCommit: Array<() => void | Promise<void>> = [];
    const result = await this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId}, true)`;
        await tx.$executeRaw`
          SELECT set_config('app.rls_bypass', ${ctx.bypass ? 'on' : 'off'}, true)
        `;
        return rlsAls.run({ tx, afterCommit }, fn);
      },
      { maxWait: 15_000, timeout: 120_000 },
    );
    await flushAfterRlsCommit(afterCommit);
    return result;
  }
}
