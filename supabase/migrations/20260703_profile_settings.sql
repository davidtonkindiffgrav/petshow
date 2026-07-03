alter table profiles
  add column if not exists avatar_url       text,
  add column if not exists bio              text,
  add column if not exists default_timezone text,
  add column if not exists default_currency text;
