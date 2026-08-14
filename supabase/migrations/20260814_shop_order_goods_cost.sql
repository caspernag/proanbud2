-- Manuell overstyring av varekost per ordre.
--
-- Varekosten hentes normalt fra Byggmakker-prislisten, som er eks. mva og
-- er kilden dekningsbidraget regnes mot. Prislisten er et øyeblikksbilde:
-- leverandøren kan fakturere en annen pris, gi rabatt, eller prisen kan ha
-- endret seg mellom bestilling og levering. Når fakturaen foreligger kan
-- admin legge inn faktisk varekost her, og den overstyrer prislisten.

alter table public.shop_orders
  add column if not exists goods_cost_nok integer;

comment on column public.shop_orders.goods_cost_nok is
  'Faktisk varekost EKS. MVA for hele ordren. NULL = bruk prislisten.';
