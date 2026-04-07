import { getPriceListProducts } from "@/lib/price-lists";
import type { PriceListProduct } from "@/lib/price-lists";

export type MaterialCatalogEntry = {
  id: string;
  productName: string;
  quantity: string;
  comment: string;
  quantityReason: string;
  nobbNumber: string;
  supplierName: string;
  unitPriceNok: number;
  sectionTitle: string;
  category: string;
};

export async function getMaterialCatalogEntries(preloadedProducts?: PriceListProduct[]) {
  const products = preloadedProducts ?? (await getPriceListProducts());

  return products.map((product) => ({
    id: product.id,
    productName: product.productName,
    quantity: product.quantitySuggestion,
    comment: `${product.brand} · ${product.supplierName}`,
    quantityReason: product.quantityReason,
    nobbNumber: product.nobbNumber,
    supplierName: product.supplierName,
    unitPriceNok: product.priceNok,
    sectionTitle: product.sectionTitle,
    category: product.category,
  }));
}
