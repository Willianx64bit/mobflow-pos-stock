ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '["PDV","Conferência"]'::jsonb;

UPDATE public.profiles
SET permissions = CASE
  WHEN role = 'manager' THEN '["PDV","Conferência","Validade","Fiado","Gerência"]'::jsonb
  WHEN permissions IS NULL OR permissions = '[]'::jsonb THEN '["PDV","Conferência"]'::jsonb
  ELSE permissions
END
WHERE permissions IS NULL OR permissions = '[]'::jsonb OR role = 'manager';

COMMENT ON COLUMN public.profiles.permissions IS 'Áreas liberadas para cada usuário MobFlow; Gerência ainda exige a senha exclusiva da empresa.';
