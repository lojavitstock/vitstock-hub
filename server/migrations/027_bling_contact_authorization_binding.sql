-- Bind contact-directory snapshots to the successful OAuth authorization that
-- produced them. Existing snapshots cannot be proven to belong to a current
-- authorization, so assign them distinct IDs and retain them as unusable history
-- until an explicit sync creates a generation for the current authorization.
ALTER TABLE bling_connections
  ADD COLUMN authorization_id UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE bling_contact_directory_generations
  ADD COLUMN authorization_id UUID;

UPDATE bling_contact_directory_generations
SET authorization_id = gen_random_uuid()
WHERE authorization_id IS NULL;

ALTER TABLE bling_contact_directory_generations
  ALTER COLUMN authorization_id SET NOT NULL;
