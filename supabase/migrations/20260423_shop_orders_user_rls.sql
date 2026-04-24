-- Allow authenticated users to read their own shop orders matched by email
create policy "Users can view own shop orders"
  on public.shop_orders
  for select
  to authenticated
  using (customer_email = auth.email());

create policy "Users can view own shop order items"
  on public.shop_order_items
  for select
  to authenticated
  using (
    order_id in (
      select id from public.shop_orders
      where customer_email = auth.email()
    )
  );
