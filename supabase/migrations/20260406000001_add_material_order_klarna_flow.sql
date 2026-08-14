alter table public.material_orders
  drop constraint if exists material_orders_checkout_flow_check;

alter table public.material_orders
  add constraint material_orders_checkout_flow_check
  check (checkout_flow in ('pay_now', 'klarna', 'business_invoice', 'financing'));
