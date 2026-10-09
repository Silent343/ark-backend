CREATE OR REPLACE FUNCTION teluria.reject_activity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit entries are append-only';
END;
$$;

CREATE TRIGGER activities_immutable
BEFORE UPDATE OR DELETE ON teluria.activities
FOR EACH ROW EXECUTE FUNCTION teluria.reject_activity_mutation();
