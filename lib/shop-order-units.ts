import { getStorefrontProductsByIds } from "@/lib/storefront";

export type ShopOrderItemWithUnit = {
  product_id: string;
  unit: string;
};

export async function withResolvedShopOrderUnits<T extends ShopOrderItemWithUnit>(items: T[]) {
  const productIds = Array.from(new Set(items.map((item) => item.product_id).filter(Boolean)));

  if (productIds.length === 0) {
    return items;
  }

  const products = await getStorefrontProductsByIds(productIds);
  const salesUnitByProductId = new Map(
    products.map((product) => [product.id, product.salesUnit ?? product.unit] as const),
  );

  return items.map((item) => ({
    ...item,
    unit: salesUnitByProductId.get(item.product_id) ?? item.unit,
  }));
}
