import { asc, eq, inArray, type SQL } from 'drizzle-orm';

import type { AppDatabase } from '../../infrastructure/db/database.js';
import {
  giftOrderItems,
  giftOrders,
  giftPackageItems,
  giftPackages,
} from '../../infrastructure/db/schema/index.js';

// Read the stored allocation and its immutable published content in two bulk queries.
export async function loadOrderPackages(database: AppDatabase, condition: SQL) {
  const allocations = await database
    .select({
      id: giftOrderItems.id,
      giftOrderId: giftOrderItems.giftOrderId,
      giftPackageId: giftPackages.id,
      name: giftPackages.name,
      description: giftPackages.description,
    })
    .from(giftOrderItems)
    .innerJoin(giftOrders, eq(giftOrders.id, giftOrderItems.giftOrderId))
    .innerJoin(giftPackages, eq(giftPackages.id, giftOrderItems.giftPackageId))
    .where(condition)
    .orderBy(asc(giftOrderItems.sortOrder));
  if (allocations.length === 0) return [];
  const packageIds = [...new Set(allocations.map((item) => item.giftPackageId))];
  const items = await database
    .select()
    .from(giftPackageItems)
    .where(inArray(giftPackageItems.giftPackageId, packageIds))
    .orderBy(asc(giftPackageItems.sortOrder));
  const itemsByPackage = new Map<
    string,
    { name: string; description: string; quantity: number }[]
  >();
  for (const item of items) {
    const values = itemsByPackage.get(item.giftPackageId) ?? [];
    values.push({ name: item.name, description: item.description, quantity: item.quantity });
    itemsByPackage.set(item.giftPackageId, values);
  }
  return allocations.map((allocation) => ({
    id: allocation.id,
    giftOrderId: allocation.giftOrderId,
    name: allocation.name,
    description: allocation.description,
    items: itemsByPackage.get(allocation.giftPackageId) ?? [],
  }));
}
