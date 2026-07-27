-- Rename show_categories.description to criteria — the field is judging
-- guidance ("what should judges look for"), not a general blurb, and the
-- old name invited confusion with a chance-based/subjective system.
alter table show_categories rename column description to criteria;
