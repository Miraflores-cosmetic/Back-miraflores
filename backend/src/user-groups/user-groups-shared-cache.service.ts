import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CatalogGroupVisibility } from '@prisma/client';
import { createClient, type RedisClientType } from 'redis';
import type { CommerceContext } from './commerce-context.types';

export type DefaultGroupsCache = {
  guest: {
    id: string;
    name: string;
    slug: string;
    allowCatalogDiscounts: boolean;
    allowPromoCodes: boolean;
    priceRounding: CommerceContext['priceRounding'];
  };
  registered: {
    id: string;
    name: string;
    slug: string;
    allowCatalogDiscounts: boolean;
    allowPromoCodes: boolean;
    priceRounding: CommerceContext['priceRounding'];
  };
};

const VERSION_KEY = 'user-groups:shared:version';
const INVALIDATE_CHANNEL = 'user-groups:shared:invalidate';
const MEMORY_TTL_MS = 30_000;

@Injectable()
export class UserGroupsSharedCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UserGroupsSharedCacheService.name);
  private localVersion = 0;
  private defaults: DefaultGroupsCache | null = null;
  private rules: CatalogGroupVisibility[] | null = null;
  private defaultsLoadedAt = 0;
  private rulesLoadedAt = 0;
  private pubClient: RedisClientType | null = null;
  private subClient: RedisClientType | null = null;
  private redisConnected = false;
  private memoryOnlyVersion = 0;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('REDIS_URL')?.trim();
    if (!url) {
      this.logger.log(
        'User groups shared cache: in-memory (set REDIS_URL for horizontal scale + pub/sub)',
      );
      return;
    }

    this.pubClient = createClient({ url });
    this.subClient = createClient({ url });
    this.pubClient.on('error', (err) => {
      this.logger.warn(
        `User groups cache Redis error: ${err instanceof Error ? err.message : err}`,
      );
    });
    this.subClient.on('error', (err) => {
      this.logger.warn(
        `User groups cache Redis sub error: ${err instanceof Error ? err.message : err}`,
      );
    });

    try {
      await this.pubClient.connect();
      await this.subClient.connect();
      await this.subClient.subscribe(INVALIDATE_CHANNEL, (message) => {
        const version = Number.parseInt(message, 10);
        if (Number.isFinite(version)) {
          this.applyRemoteVersion(version);
        } else {
          this.clearLocal();
        }
      });
      const remote = await this.fetchRemoteVersion();
      this.localVersion = remote;
      this.redisConnected = true;
      this.logger.log('User groups shared cache: Redis + pub/sub');
    } catch (err) {
      this.logger.warn(
        `User groups cache: Redis unavailable (${err instanceof Error ? err.message : err}), in-memory fallback`,
      );
      await this.disconnectRedis();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnectRedis();
  }

  async getDefaults(
    loader: () => Promise<DefaultGroupsCache | null>,
  ): Promise<DefaultGroupsCache | null> {
    await this.syncVersion();
    const now = Date.now();
    if (
      this.defaults &&
      (!this.redisConnected ? now - this.defaultsLoadedAt < MEMORY_TTL_MS : true)
    ) {
      return this.defaults;
    }
    this.defaults = await loader();
    this.defaultsLoadedAt = now;
    return this.defaults;
  }

  async getRules(loader: () => Promise<CatalogGroupVisibility[]>): Promise<CatalogGroupVisibility[]> {
    await this.syncVersion();
    const now = Date.now();
    if (this.rules && (!this.redisConnected ? now - this.rulesLoadedAt < MEMORY_TTL_MS : true)) {
      return this.rules;
    }
    this.rules = await loader();
    this.rulesLoadedAt = now;
    return this.rules;
  }

  invalidate(): void {
    this.memoryOnlyVersion += 1;
    this.localVersion = this.memoryOnlyVersion;
    this.clearLocal();

    if (!this.redisConnected || !this.pubClient) return;

    void this.pubClient
      .incr(VERSION_KEY)
      .then((version) => this.pubClient!.publish(INVALIDATE_CHANNEL, String(version)))
      .catch((err) => {
        this.logger.warn(
          `User groups cache invalidate failed: ${err instanceof Error ? err.message : err}`,
        );
      });
  }

  private async syncVersion(): Promise<void> {
    if (!this.redisConnected) {
      if (this.localVersion !== this.memoryOnlyVersion) {
        this.localVersion = this.memoryOnlyVersion;
        this.clearLocal();
      }
      return;
    }
    const remote = await this.fetchRemoteVersion();
    if (remote !== this.localVersion) {
      this.applyRemoteVersion(remote);
    }
  }

  private applyRemoteVersion(version: number): void {
    this.localVersion = version;
    this.clearLocal();
  }

  private clearLocal(): void {
    this.defaults = null;
    this.rules = null;
    this.defaultsLoadedAt = 0;
    this.rulesLoadedAt = 0;
  }

  private async fetchRemoteVersion(): Promise<number> {
    if (!this.redisConnected || !this.pubClient) return this.memoryOnlyVersion;
    try {
      const raw = await this.pubClient.get(VERSION_KEY);
      if (raw == null) return 0;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return this.localVersion;
    }
  }

  private async disconnectRedis(): Promise<void> {
    this.redisConnected = false;
    for (const client of [this.subClient, this.pubClient]) {
      if (!client) continue;
      try {
        await client.quit();
      } catch {
        /* ignore */
      }
    }
    this.subClient = null;
    this.pubClient = null;
  }
}
