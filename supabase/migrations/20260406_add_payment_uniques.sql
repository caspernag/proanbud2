create unique index if not exists projects_stripe_checkout_session_id_key
on public.projects(stripe_checkout_session_id)
where stripe_checkout_session_id is not null;

create unique index if not exists material_orders_checkout_session_id_key
on public.material_orders(checkout_session_id)
where checkout_session_id is not null;

create unique index if not exists material_orders_payment_intent_id_key
on public.material_orders(payment_intent_id)
where payment_intent_id is not null;
