/**
 * Одноразово: −10% на все leaf-категории для группы isDefaultRegistered (Розница).
 *
 *   cd backend && npx ts-node --transpile-only scripts/seed-retail-category-prices-10.ts
 *
 * Безопасно перезапускать: upsert PERCENT_OFF 10 на каждый leaf.
 */
import { GroupCategoryPriceType, PrismaClient } from '@prisma/client';

const PERCENT = 10;

async function main() {
  const prisma = new PrismaClient();
  try {
    const group = await prisma.userGroup.findFirst({
      where: { isDefaultRegistered: true },
      select: { id: true, name: true, slug: true },
    });
    if (!group) {
      throw new Error('Группа isDefaultRegistered не найдена (seed retail-registered)');
    }

    const categories = await prisma.category.findMany({ select: { id: true, name: true } });
    const childGroups = await prisma.category.groupBy({
      by: ['parentId'],
      where: { parentId: { not: null } },
      _count: { _all: true },
    });
    const parentIds = new Set(
      childGroups.map((x) => x.parentId).filter(Boolean) as string[],
    );
    const leaves = categories.filter((c) => !parentIds.has(c.id));

    let created = 0;
    let updated = 0;
    for (const leaf of leaves) {
      const existing = await prisma.groupCategoryPrice.findUnique({
        where: {
          groupId_categoryId: { groupId: group.id, categoryId: leaf.id },
        },
      });
      if (existing) {
        if (existing.type !== GroupCategoryPriceType.PERCENT_OFF || existing.value !== PERCENT) {
          await prisma.groupCategoryPrice.update({
            where: {
              groupId_categoryId: { groupId: group.id, categoryId: leaf.id },
            },
            data: { type: GroupCategoryPriceType.PERCENT_OFF, value: PERCENT },
          });
          updated++;
        }
      } else {
        await prisma.groupCategoryPrice.create({
          data: {
            groupId: group.id,
            categoryId: leaf.id,
            type: GroupCategoryPriceType.PERCENT_OFF,
            value: PERCENT,
          },
        });
        created++;
      }
    }

    const total = await prisma.groupCategoryPrice.count({ where: { groupId: group.id } });
    console.log(
      JSON.stringify(
        {
          groupId: group.id,
          groupName: group.name,
          slug: group.slug,
          leafCategories: leaves.length,
          created,
          updated,
          totalRules: total,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
