"use client";

import { useState } from "react";

import { AddToCartButton } from "@/app/_components/storefront/add-to-cart-button";
import { ProductUnitCalculator } from "@/app/_components/storefront/product-unit-calculator";

type ProductPurchaseControlsProps = {
  productId: string;
  unitPriceNok: number;
  priceUnit?: string;
  salesUnit?: string;
  packageAreaSqm?: number;
};

export function ProductPurchaseControls({
  productId,
  unitPriceNok,
  priceUnit,
  salesUnit,
  packageAreaSqm,
}: ProductPurchaseControlsProps) {
  const [quantity, setQuantity] = useState(1);

  return (
    <div className="w-full">
      <ProductUnitCalculator
        unitPriceNok={unitPriceNok}
        priceUnit={priceUnit}
        salesUnit={salesUnit}
        packageAreaSqm={packageAreaSqm}
        onPackagesChange={setQuantity}
      />

      <div className="mt-4">
        <AddToCartButton productId={productId} quantity={quantity} fullWidth />
      </div>
    </div>
  );
}