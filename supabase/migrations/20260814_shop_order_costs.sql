-- Faktiske kostnader per butikkordre, for dekningsbidragsberegning.
--
-- Varekost hentes fra Byggmakker-prislisten (eks. mva), men frakt og
-- eventuelle ekstrakostnader kjenner vi først når leverandørfakturaen kommer.
-- Alle beløp lagres EKS. MVA, fordi inngående mva er fradragsberettiget og
-- dekningsbidraget derfor skal regnes uten mva på begge sider.

alter table public.shop_orders
  add column if not exists freight_cost_nok integer,
  add column if not exists other_cost_nok integer,
  add column if not exists cost_note text not null default '';

comment on column public.shop_orders.freight_cost_nok is
  'Faktisk fraktkostnad EKS. MVA. NULL = ikke registrert ennå.';
comment on column public.shop_orders.other_cost_nok is
  'Andre direkte kostnader EKS. MVA (retur, kranbil, ekstra håndtering).';
