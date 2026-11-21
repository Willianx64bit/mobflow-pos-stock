-- Persist altitude and vertical accuracy for each login audit event.
-- Existing login history remains unchanged; new events can store these values.
ALTER TABLE public.mobflow_login_audit_events
  ADD COLUMN IF NOT EXISTS altitude_m numeric(10,2)
    CHECK (altitude_m IS NULL OR altitude_m BETWEEN -12000 AND 100000),
  ADD COLUMN IF NOT EXISTS altitude_accuracy_m numeric(10,2)
    CHECK (altitude_accuracy_m IS NULL OR altitude_accuracy_m > 0);
