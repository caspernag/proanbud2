"use client";

import { useState, type ReactNode } from "react";

import { AddToCartWithQuantity } from "@/app/_components/storefront/add-to-cart-with-quantity";
import { ProductUnitCalculator } from "@/app/_components/storefront/product-unit-calculator";

type ProductPurchaseControlsProps = {
  productId: string;
  unitPriceNok: number;
  priceUnit?: string;
  salesUnit?: string;
  packageAreaSqm?: number;
  secondaryAction?: ReactNode;
};

export function ProductPurchaseControls({
  productId,
  unitPriceNok,
  priceUnit,
  salesUnit,
  packageAreaSqm,
  secondaryAction,
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
        <AddToCartWithQuantity
          productId={productId}
          quantity={quantity}
          onQuantityChange={setQuantity}
          secondaryAction={secondaryAction}
        />
      </div>
    </div>
  );
}