alter table public.material_orders
add column if not exists delivery_target text not null default 'door' check (delivery_target in ('door', 'construction_site')),
add column if not exists unloading_method text not null default 'standard' check (unloading_method in ('standard', 'crane_needed', 'customer_machine'));