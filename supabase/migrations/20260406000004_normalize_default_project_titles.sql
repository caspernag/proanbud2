update public.projects
set title = regexp_replace(title, '^(nytt byggeprosjekt)\s*\d{6,}$', 'Nytt byggeprosjekt', 'i')
where title ~* '^(nytt byggeprosjekt)\s*\d{6,}$';
