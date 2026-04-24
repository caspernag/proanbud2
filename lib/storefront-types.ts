export type StorefrontProductSource = "vector_store" | "price_lists";

export type StorefrontProduct = {
  id: string;
  slug: string;
  nobbNumber: string;
  productName: string;
  supplierName: string;
  brand: string;
  unit: string;
  unitPriceNok: number;
  listPriceNok: number;
  sectionTitle: string;
  category: string;
  description: string;
  ean?: string;
  datasheetUrl?: string;
  imageUrl?: string;
  technicalDetails: string[];
  quantitySuggestion: string;
  quantityReason: string;
  lastUpdated: string;
  source: StorefrontProductSource;
};

export type StorefrontSortOption =
  | "relevance"
  | "price_asc"
  | "price_desc"
  | "name_asc"
  | "newest";

export type StorefrontProductQuery = {
  q?: string;
  category?: string;
  supplier?: string;
  sort?: StorefrontSortOption;
  page?: number;
  pageSize?: number;
};

export type StorefrontProductQueryResult = {
  items: StorefrontProduct[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  categories: string[];
  suppliers: string[];
  categoryCounts: Record<string, number>;
  supplierCounts: Record<string, number>;
  priceRange: { min: number; max: number };
  source: StorefrontProductSource;
  vectorStoreId: string | null;
};
