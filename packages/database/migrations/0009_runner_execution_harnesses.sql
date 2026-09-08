ALTER TABLE "devices" ADD COLUMN "execution_harnesses" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "devices" SET "execution_harnesses" = jsonb_strip_nulls(jsonb_build_object(
  'codex', CASE WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements("repositories") repository
    WHERE repository->>'codexDevelopment' = 'true'
  ) THEN jsonb_strip_nulls(jsonb_build_object('models', CASE WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements("repositories") repository
    WHERE repository->>'codexDevelopment' = 'true'
      AND jsonb_typeof(repository->'codexModels') IS DISTINCT FROM 'array'
  ) THEN NULL ELSE (
    SELECT jsonb_agg(model ORDER BY model)
    FROM (
      SELECT DISTINCT jsonb_array_elements_text(repository->'codexModels') AS model
      FROM jsonb_array_elements("repositories") repository
      WHERE jsonb_typeof(repository->'codexModels') = 'array'
    ) models
  ) END)) END,
  'claude', CASE WHEN EXISTS (
    SELECT 1 FROM jsonb_array_elements("repositories") repository
    WHERE repository->>'claudeDevelopment' = 'true'
  ) THEN jsonb_build_object('models', COALESCE((
    SELECT jsonb_agg(model ORDER BY model)
    FROM (
      SELECT DISTINCT jsonb_array_elements_text(repository->'claudeModels') AS model
      FROM jsonb_array_elements("repositories") repository
      WHERE jsonb_typeof(repository->'claudeModels') = 'array'
    ) models
  ), '["opus"]'::jsonb)) END
));--> statement-breakpoint
UPDATE "devices" SET "repositories" = COALESCE((
  SELECT jsonb_agg(repository - 'codexDevelopment' - 'codexModels' - 'claudeDevelopment' - 'claudeModels')
  FROM jsonb_array_elements("repositories") repository
), '[]'::jsonb);
