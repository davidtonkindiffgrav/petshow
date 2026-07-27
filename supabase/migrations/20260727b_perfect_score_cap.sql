-- Perfect-score cap (Round 1 judging)
-- Platform-wide limit on how many entries a judge may award a perfect score
-- (slider maxed to 100) to, per category. Editable from Admin > Settings.
-- Read directly by judge.astro on init.

insert into platform_settings (key, value)
values ('max_perfect_scores_per_category', '12')
on conflict (key) do nothing;
