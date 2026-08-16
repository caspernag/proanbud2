-- Prisimporten skrev popularity_score = 0 på hver rad, så hele katalogen mistet
-- sorteringsvekten sin. Koden er rettet (importen beholder nå eksisterende
-- score), men de nullstilte radene må regnes ut på nytt.
--
-- Scoren er deterministisk — samme formel som popularityScore() i lib/storefront.ts
-- med tom brukerprofil: kategorivekt − variantstraff + rabattbonus.

update public.storefront_products
set
  popularity_score =
    coalesce(
      case btrim(category)
        when 'Konstruksjonsvirke'    then 100
        when 'Festemidler'           then 95
        when 'Isolasjon'             then 90
        when 'Gips og plater'        then 85
        when 'Tetting og fukt'       then 75
        when 'Maling'                then 70
        when 'Overflatebehandling'   then 60
        when 'Terrasse'              then 50
        when 'Baderom'               then 45
        when 'Gulv'                  then 40
        when 'Generelt'              then 20
      end,
      20
    )
    -- Tilbehør og småvarianter skal ikke toppe listene.
    - case
        when btrim(product_name) like '+%' then 40
        when btrim(product_name) ~* '^KARMSETT?\y' then 40
        else 0
      end
    -- Varer med reell rabatt løftes litt.
    + case when list_price_nok > unit_price_nok then 5 else 0 end,
  updated_at = now()
where popularity_score = 0 or popularity_score is null;
