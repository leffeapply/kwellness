-- Enum values must be committed before later migrations use them in constraints,
-- casts, functions, and stored rows.
alter type public.care_service_type add value if not exists 'MASSAGE';
