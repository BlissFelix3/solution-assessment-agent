CREATE FUNCTION reject_source_history_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Source history in % is immutable', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER source_revisions_no_update_delete
BEFORE UPDATE OR DELETE ON source_revisions
FOR EACH ROW EXECUTE FUNCTION reject_source_history_change();

CREATE TRIGGER source_revisions_no_truncate
BEFORE TRUNCATE ON source_revisions
FOR EACH STATEMENT EXECUTE FUNCTION reject_source_history_change();

CREATE TRIGGER source_documents_no_update_delete
BEFORE UPDATE OR DELETE ON source_documents
FOR EACH ROW EXECUTE FUNCTION reject_source_history_change();

CREATE TRIGGER source_documents_no_truncate
BEFORE TRUNCATE ON source_documents
FOR EACH STATEMENT EXECUTE FUNCTION reject_source_history_change();
