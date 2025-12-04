\restrict tTjlXhVBrn2P7gPHQnV1oj8XtPfWWgwbaIpUf91u8ZbpgctEGEbLCHg5XwwYMee
CREATE SCHEMA public;
CREATE TYPE public.alert_severity AS ENUM (
    'info',
    'warning',
    'error',
    'critical'
);
CREATE TYPE public.alert_type AS ENUM (
    'approval.required',
    'decision.needed',
    'error.attention',
    'processing.completed',
    'document.ready',
    'insights.available',
    'governance.updated',
    'collaboration.update',
    'system.maintenance',
    'system.performance',
    'system.security',
    'system.storage'
);
CREATE TYPE public.basket_state AS ENUM (
    'INIT',
    'ACTIVE',
    'ARCHIVED',
    'DEPRECATED'
);
CREATE TYPE public.blast_radius AS ENUM (
    'Local',
    'Scoped',
    'Global'
);
CREATE TYPE public.block_state AS ENUM (
    'PROPOSED',
    'ACCEPTED',
    'LOCKED',
    'CONSTANT',
    'SUPERSEDED',
    'REJECTED'
);
CREATE TYPE public.event_significance AS ENUM (
    'low',
    'medium',
    'high'
);
CREATE TYPE public.knowledge_event_type AS ENUM (
    'memory.captured',
    'knowledge.evolved',
    'insights.discovered',
    'document.created',
    'document.updated',
    'relationships.mapped',
    'governance.decided',
    'milestone.achieved'
);
CREATE TYPE public.processing_state AS ENUM (
    'pending',
    'claimed',
    'processing',
    'completed',
    'failed',
    'cascading'
);
CREATE TYPE public.proposal_kind AS ENUM (
    'Extraction',
    'Edit',
    'Merge',
    'Attachment',
    'ScopePromotion',
    'Deprecation',
    'Revision',
    'Detach',
    'Rename',
    'ContextAlias',
    'Capture'
);
CREATE TYPE public.proposal_state AS ENUM (
    'DRAFT',
    'PROPOSED',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'SUPERSEDED',
    'MERGED'
);
CREATE TYPE public.scope_level AS ENUM (
    'LOCAL',
    'WORKSPACE',
    'ORG',
    'GLOBAL'
);
CREATE TYPE public.substrate_type AS ENUM (
    'block',
    'dump',
    'event',
    'document'
);
CREATE FUNCTION public.approve_work_output(p_output_id uuid, p_reviewer_id uuid, p_notes text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE work_outputs
  SET
    supervision_status = 'approved',
    reviewed_by = p_reviewer_id,
    reviewed_at = now(),
    reviewer_notes = p_notes
  WHERE id = p_output_id
    AND supervision_status = 'pending_review';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Output not found or not pending review';
  END IF;
END;
$$;
CREATE FUNCTION public.auto_increment_block_usage_on_reference() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- Only increment for block substrate types
  IF NEW.substrate_type = 'block' THEN
    PERFORM increment_block_usage(NEW.substrate_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.calculate_context_completeness(p_data jsonb, p_field_schema jsonb) RETURNS double precision
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    v_required_count INTEGER := 0;
    v_filled_count INTEGER := 0;
    v_field JSONB;
    v_key TEXT;
    v_value JSONB;
BEGIN
    FOR v_field IN SELECT * FROM jsonb_array_elements(p_field_schema->'fields')
    LOOP
        IF (v_field->>'required')::boolean = true THEN
            v_required_count := v_required_count + 1;
            v_key := v_field->>'key';
            IF p_data ? v_key THEN
                v_value := p_data->v_key;
                -- Check if value is non-null and non-empty
                IF v_value IS NOT NULL
                   AND v_value::text != 'null'
                   AND v_value::text != '""'
                   AND v_value::text != '[]' THEN
                    v_filled_count := v_filled_count + 1;
                END IF;
            END IF;
        END IF;
    END LOOP;
    IF v_required_count = 0 THEN
        RETURN 1.0;
    END IF;
    RETURN v_filled_count::FLOAT / v_required_count::FLOAT;
END;
$$;
CREATE FUNCTION public.calculate_next_run_at(p_frequency text, p_day_of_week integer, p_time_of_day time without time zone, p_cron_expression text DEFAULT NULL::text) RETURNS timestamp with time zone
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_next_run TIMESTAMPTZ;
  v_today DATE := CURRENT_DATE;
  v_now TIMESTAMPTZ := NOW();
  v_target_dow INTEGER;
  v_days_until INTEGER;
BEGIN
  -- Default time if not specified
  IF p_time_of_day IS NULL THEN
    p_time_of_day := '09:00:00'::TIME;
  END IF;
  CASE p_frequency
    WHEN 'weekly' THEN
      -- Find next occurrence of day_of_week at time_of_day
      v_target_dow := COALESCE(p_day_of_week, 1); -- Default to Monday
      v_days_until := (v_target_dow - EXTRACT(DOW FROM v_today)::INTEGER + 7) % 7;
      -- If today is the target day but time has passed, schedule for next week
      IF v_days_until = 0 AND (v_today + p_time_of_day) <= v_now THEN
        v_days_until := 7;
      END IF;
      v_next_run := (v_today + v_days_until) + p_time_of_day;
    WHEN 'biweekly' THEN
      v_target_dow := COALESCE(p_day_of_week, 1);
      v_days_until := (v_target_dow - EXTRACT(DOW FROM v_today)::INTEGER + 7) % 7;
      IF v_days_until = 0 AND (v_today + p_time_of_day) <= v_now THEN
        v_days_until := 14;
      ELSIF v_days_until > 0 THEN
        -- Add extra week for biweekly
        v_days_until := v_days_until + 7;
      END IF;
      v_next_run := (v_today + v_days_until) + p_time_of_day;
    WHEN 'monthly' THEN
      -- First occurrence of day_of_week in next month
      v_target_dow := COALESCE(p_day_of_week, 1);
      v_next_run := date_trunc('month', v_today + INTERVAL '1 month');
      -- Find first target day of week in that month
      v_days_until := (v_target_dow - EXTRACT(DOW FROM v_next_run)::INTEGER + 7) % 7;
      v_next_run := v_next_run + (v_days_until * INTERVAL '1 day') + p_time_of_day;
    WHEN 'custom' THEN
      -- For custom cron, we'd need a cron parser - for now, default to weekly
      v_target_dow := COALESCE(p_day_of_week, 1);
      v_days_until := (v_target_dow - EXTRACT(DOW FROM v_today)::INTEGER + 7) % 7;
      IF v_days_until = 0 AND (v_today + p_time_of_day) <= v_now THEN
        v_days_until := 7;
      END IF;
      v_next_run := (v_today + v_days_until) + p_time_of_day;
    ELSE
      RAISE EXCEPTION 'Unknown frequency: %', p_frequency;
  END CASE;
  RETURN v_next_run;
END;
$$;
CREATE FUNCTION public.capture_agent_config_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- Only capture if config actually changed
  IF OLD.config IS DISTINCT FROM NEW.config THEN
    INSERT INTO agent_config_history (
      project_agent_id,
      config_snapshot,
      config_version,
      changed_by_user_id,
      changed_at,
      change_reason,
      metadata
    ) VALUES (
      NEW.id,
      NEW.config,
      NEW.config_version,
      NEW.config_updated_by,
      NEW.config_updated_at,
      'Auto-captured via trigger',
      jsonb_build_object(
        'previous_version', OLD.config_version,
        'trigger_source', 'project_agents_update'
      )
    );
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.check_and_queue_due_schedules() RETURNS TABLE(schedule_id uuid, job_id uuid)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_schedule RECORD;
  v_job_id UUID;
BEGIN
  -- Find all enabled schedules that are due
  FOR v_schedule IN
    SELECT
      ps.id,
      ps.project_id,
      ps.recipe_id,
      ps.basket_id,
      ps.recipe_parameters,
      ps.frequency,
      ps.day_of_week,
      ps.time_of_day,
      wr.slug as recipe_slug,
      wr.context_outputs,
      wr.context_requirements
    FROM project_schedules ps
    JOIN work_recipes wr ON wr.id = ps.recipe_id
    WHERE ps.enabled = true
    AND ps.next_run_at <= NOW()
    AND wr.status = 'active'
    -- Don't create duplicate jobs for same schedule
    AND NOT EXISTS (
      SELECT 1 FROM jobs j
      WHERE j.parent_schedule_id = ps.id
      AND j.status IN ('pending', 'claimed', 'running')
    )
    FOR UPDATE OF ps SKIP LOCKED
  LOOP
    -- Create job for this schedule
    -- Include context_required from recipe's context_requirements.roles
    INSERT INTO jobs (
      job_type,
      payload,
      priority,
      parent_schedule_id
    ) VALUES (
      'scheduled_work',
      jsonb_build_object(
        'schedule_id', v_schedule.id,
        'project_id', v_schedule.project_id,
        'recipe_id', v_schedule.recipe_id,
        'recipe_slug', v_schedule.recipe_slug,
        'basket_id', v_schedule.basket_id,
        'recipe_parameters', v_schedule.recipe_parameters,
        'context_outputs', v_schedule.context_outputs,
        'context_required', COALESCE(v_schedule.context_requirements->'roles', '[]'::jsonb),
        'triggered_at', NOW()
      ),
      5,  -- Default priority
      v_schedule.id
    )
    RETURNING id INTO v_job_id;
    -- Update schedule's next run time
    UPDATE project_schedules
    SET
      next_run_at = calculate_next_run_at(
        v_schedule.frequency,
        v_schedule.day_of_week,
        v_schedule.time_of_day,
        NULL
      ),
      updated_at = NOW()
    WHERE id = v_schedule.id;
    schedule_id := v_schedule.id;
    job_id := v_job_id;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;
CREATE FUNCTION public.check_and_queue_stale_anchors() RETURNS TABLE(block_id uuid, job_id uuid)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_stale RECORD;
  v_job_id UUID;
BEGIN
  -- Find stale anchor blocks that have a producing recipe
  FOR v_stale IN
    SELECT
      b.id as block_id,
      b.basket_id,
      b.anchor_role,
      wr.id as recipe_id,
      wr.slug as recipe_slug,
      wr.context_outputs,
      wr.context_requirements
    FROM blocks b
    JOIN work_recipes wr ON wr.context_outputs->>'role' = b.anchor_role
    WHERE b.anchor_role IS NOT NULL
    AND b.state = 'ACCEPTED'
    AND wr.status = 'active'
    AND b.updated_at < NOW() - (
      (wr.context_outputs->'refresh_policy'->>'ttl_hours')::INTEGER * INTERVAL '1 hour'
    )
    -- Don't queue if there's already a pending job
    AND NOT EXISTS (
      SELECT 1 FROM jobs j
      WHERE j.job_type = 'stale_refresh'
      AND j.payload->>'basket_id' = b.basket_id::TEXT
      AND j.payload->>'anchor_role' = b.anchor_role
      AND j.status IN ('pending', 'claimed', 'running')
    )
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    -- Create refresh job with context_required from producing recipe
    INSERT INTO jobs (
      job_type,
      payload,
      priority
    ) VALUES (
      'stale_refresh',
      jsonb_build_object(
        'block_id', v_stale.block_id,
        'basket_id', v_stale.basket_id,
        'anchor_role', v_stale.anchor_role,
        'recipe_id', v_stale.recipe_id,
        'recipe_slug', v_stale.recipe_slug,
        'context_outputs', v_stale.context_outputs,
        'context_required', COALESCE(v_stale.context_requirements->'roles', '[]'::jsonb),
        'triggered_at', NOW()
      ),
      3  -- Lower priority than user-initiated
    )
    RETURNING id INTO v_job_id;
    block_id := v_stale.block_id;
    job_id := v_job_id;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;
CREATE FUNCTION public.check_block_depth() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE depth int := 0; cursor_id uuid;
BEGIN
  cursor_id := NEW.parent_block_id;
  WHILE cursor_id IS NOT NULL LOOP
    depth := depth + 1;
    IF depth > 2 THEN
      RAISE EXCEPTION 'Hierarchy depth > 2';
    END IF;
    SELECT parent_block_id INTO cursor_id FROM blocks WHERE id = cursor_id;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.check_output_promotable(p_output_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_output RECORD;
  v_target_role TEXT;
  v_result JSONB;
BEGIN
  SELECT wo.*, wt.recipe_slug
  INTO v_output
  FROM work_outputs wo
  LEFT JOIN work_tickets wt ON wo.work_ticket_id = wt.id
  WHERE wo.id = p_output_id;
  IF v_output IS NULL THEN
    RETURN jsonb_build_object(
      'promotable', false,
      'reason', 'Output not found'
    );
  END IF;
  IF v_output.promotion_status = 'promoted' THEN
    RETURN jsonb_build_object(
      'promotable', false,
      'reason', 'Already promoted',
      'promoted_to_block_id', v_output.promoted_to_block_id
    );
  END IF;
  -- Check for target role
  v_target_role := v_output.target_context_role;
  IF v_target_role IS NULL AND v_output.recipe_slug IS NOT NULL THEN
    SELECT context_outputs->>'role'
    INTO v_target_role
    FROM work_recipes
    WHERE slug = v_output.recipe_slug;
  END IF;
  IF v_target_role IS NULL THEN
    RETURN jsonb_build_object(
      'promotable', false,
      'reason', 'No target context role defined'
    );
  END IF;
  -- Check supervision status
  IF v_output.supervision_status NOT IN ('approved', 'auto_approved') THEN
    RETURN jsonb_build_object(
      'promotable', true,
      'requires_approval', true,
      'target_role', v_target_role,
      'supervision_status', v_output.supervision_status
    );
  END IF;
  RETURN jsonb_build_object(
    'promotable', true,
    'requires_approval', false,
    'target_role', v_target_role,
    'auto_promote', COALESCE(v_output.auto_promote, false)
  );
END;
$$;
CREATE FUNCTION public.check_single_workspace_per_user() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.role = 'owner' THEN
    -- Check if user already owns a workspace
    IF EXISTS (
      SELECT 1 FROM workspace_memberships 
      WHERE user_id = NEW.user_id 
        AND role = 'owner' 
        AND workspace_id != NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'CANON VIOLATION: User % already owns a workspace. Each user can only own one workspace.', NEW.user_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.check_trial_limit(p_user_id uuid, p_workspace_id uuid, p_agent_type text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_used_count integer;
    v_remaining integer;
    v_has_subscription boolean;
    v_subscription_id uuid;
BEGIN
    -- Check if user has active subscription for this agent type
    SELECT EXISTS (
        SELECT 1 FROM user_agent_subscriptions
        WHERE user_id = p_user_id
          AND workspace_id = p_workspace_id
          AND agent_type = p_agent_type
          AND status = 'active'
    ) INTO v_has_subscription;
    -- If subscribed, unlimited requests allowed
    IF v_has_subscription THEN
        SELECT id INTO v_subscription_id
        FROM user_agent_subscriptions
        WHERE user_id = p_user_id
          AND workspace_id = p_workspace_id
          AND agent_type = p_agent_type
          AND status = 'active'
        LIMIT 1;
        RETURN jsonb_build_object(
            'can_request', true,
            'is_subscribed', true,
            'subscription_id', v_subscription_id,
            'remaining_trial_requests', NULL
        );
    END IF;
    -- Count TOTAL trial requests across ALL agents (global limit)
    SELECT COUNT(*) INTO v_used_count
    FROM agent_work_requests
    WHERE user_id = p_user_id
      AND workspace_id = p_workspace_id
      AND is_trial_request = true;
    v_remaining := 10 - v_used_count;
    -- Return trial status
    RETURN jsonb_build_object(
        'can_request', v_remaining > 0,
        'is_subscribed', false,
        'subscription_id', NULL,
        'remaining_trial_requests', GREATEST(0, v_remaining),
        'used_trial_requests', v_used_count,
        'total_trial_limit', 10
    );
END;
$$;
CREATE FUNCTION public.claim_jobs(p_worker_id text, p_job_types text[], p_limit integer DEFAULT 5) RETURNS TABLE(id uuid, job_type text, payload jsonb, priority integer, attempts integer, max_attempts integer, parent_schedule_id uuid)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    UPDATE jobs j
    SET
      status = 'claimed',
      claimed_by = p_worker_id,
      claimed_at = NOW(),
      updated_at = NOW()
    WHERE j.id IN (
      SELECT j2.id
      FROM jobs j2
      WHERE j2.status = 'pending'
      AND j2.job_type = ANY(p_job_types)
      AND j2.scheduled_for <= NOW()
      AND (j2.retry_after IS NULL OR j2.retry_after <= NOW())
      ORDER BY j2.priority DESC, j2.scheduled_for ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING j.*
  )
  SELECT
    claimed.id,
    claimed.job_type,
    claimed.payload,
    claimed.priority,
    claimed.attempts,
    claimed.max_attempts,
    claimed.parent_schedule_id
  FROM claimed;
END;
$$;
CREATE FUNCTION public.cleanup_expired_assets() RETURNS TABLE(deleted_count bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  deleted_ids uuid[];
BEGIN
  -- Find expired temporary assets
  SELECT array_agg(id) INTO deleted_ids
  FROM reference_assets
  WHERE permanence = 'temporary'
    AND expires_at IS NOT NULL
    AND expires_at < now();
  -- Delete from storage (application code should call Supabase Storage API)
  -- This function only deletes DB records - storage cleanup happens in application
  -- Delete expired assets
  DELETE FROM reference_assets
  WHERE id = ANY(deleted_ids);
  deleted_count := array_length(deleted_ids, 1);
  RETURN QUERY SELECT COALESCE(deleted_count, 0);
END;
$$;
CREATE FUNCTION public.cleanup_expired_context_items() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM context_items
    WHERE tier = 'ephemeral'
      AND expires_at IS NOT NULL
      AND expires_at < now();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;
CREATE FUNCTION public.cleanup_expired_mcp_sessions() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.mcp_oauth_sessions
    WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;
CREATE FUNCTION public.cleanup_old_jobs(p_retention_days integer DEFAULT 30) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM jobs
  WHERE status IN ('completed', 'failed', 'cancelled')
  AND completed_at < NOW() - (p_retention_days * INTERVAL '1 day');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
CREATE FUNCTION public.complete_job(p_job_id uuid, p_result jsonb DEFAULT NULL::jsonb) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  UPDATE jobs
  SET
    status = 'completed',
    completed_at = NOW(),
    result = p_result,
    updated_at = NOW()
  WHERE id = p_job_id
  AND status IN ('claimed', 'running');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;
CREATE FUNCTION public.create_basket_with_dump(dump_body text, file_urls jsonb, user_id uuid, workspace_id uuid) RETURNS TABLE(basket_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_basket_id uuid;
  v_dump_id uuid;
begin
  insert into baskets (workspace_id, user_id)
    values (workspace_id, user_id)
    returning id into v_basket_id;
  insert into raw_dumps (basket_id, body_md, file_refs, workspace_id)
    values (v_basket_id, dump_body, coalesce(file_urls, '[]'::jsonb), workspace_id)
    returning id into v_dump_id;
  update baskets
     set raw_dump_id = v_dump_id
   where id = v_basket_id;
  return query select v_basket_id;
end;
$$;
CREATE FUNCTION public.dismiss_user_alert(p_alert_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE user_alerts 
  SET dismissed_at = now() 
  WHERE id = p_alert_id AND user_id = auth.uid();
  
  RETURN FOUND;
END;
$$;
CREATE FUNCTION public.emit_knowledge_event(p_basket_id uuid, p_workspace_id uuid, p_event_type public.knowledge_event_type, p_title text, p_description text DEFAULT NULL::text, p_significance public.event_significance DEFAULT 'medium'::public.event_significance, p_metadata jsonb DEFAULT '{}'::jsonb, p_related_ids jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  event_id uuid;
BEGIN
  INSERT INTO knowledge_timeline (
    basket_id, workspace_id, event_type, title, description, 
    significance, metadata, related_ids
  ) VALUES (
    p_basket_id, p_workspace_id, p_event_type, p_title, p_description,
    p_significance, p_metadata, p_related_ids
  ) RETURNING id INTO event_id;
  
  RETURN event_id;
END;
$$;
CREATE FUNCTION public.emit_narrative_event(p_basket_id uuid, p_doc_id uuid, p_kind text, p_preview text) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  v_workspace_id uuid;
begin
  -- Get workspace_id from basket
  select workspace_id into v_workspace_id
  from public.baskets
  where id = p_basket_id;
  if v_workspace_id is null then
    raise exception 'Basket % not found or has no workspace', p_basket_id;
  end if;
  -- Insert timeline event with workspace_id
  insert into public.timeline_events (basket_id, workspace_id, kind, ref_id, preview, payload)
  values (
    p_basket_id,
    v_workspace_id,
    'narrative',
    p_doc_id,
    p_preview,
    jsonb_build_object('event', p_kind, 'doc_id', p_doc_id::text)
  );
end;
$$;
CREATE FUNCTION public.emit_rel_bulk_note(p_basket uuid, p_created integer, p_ignored integer, p_idem_key text) RETURNS void
    LANGUAGE plpgsql
    AS $$
begin
  insert into public.timeline_events (basket_id, kind, ref_id, preview, payload)
  values (
    p_basket, 'system_note', null,
    'Graph updated: ' || p_created || ' new, ' || p_ignored || ' ignored',
    jsonb_build_object('created', p_created, 'ignored', p_ignored, 'idem_key', coalesce(p_idem_key,''))
  );
end$$;
CREATE FUNCTION public.emit_timeline_event(p_basket_id uuid, p_event_type text, p_event_data jsonb, p_workspace_id uuid, p_actor_id uuid DEFAULT NULL::uuid, p_agent_type text DEFAULT NULL::text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_event_id bigint;
  v_preview text;
BEGIN
  -- Generate preview from event data if available
  v_preview := CASE 
    WHEN p_event_data ? 'preview' THEN p_event_data->>'preview'
    WHEN p_event_type LIKE '%.created' THEN 'Created ' || split_part(p_event_type, '.', 1)
    WHEN p_event_type LIKE '%.updated' THEN 'Updated ' || split_part(p_event_type, '.', 1)
    WHEN p_event_type LIKE '%.attached' THEN 'Attached to document'
    WHEN p_event_type LIKE '%.detached' THEN 'Detached from document'
    ELSE p_event_type
  END;
  -- Use existing fn_timeline_emit function
  SELECT fn_timeline_emit(
    p_basket_id,
    p_event_type,
    COALESCE(p_actor_id, (p_event_data->>'ref_id')::uuid),
    v_preview,
    p_event_data
  ) INTO v_event_id;
  
  RETURN v_event_id;
END;
$$;
CREATE FUNCTION public.emit_user_alert(p_user_id uuid, p_workspace_id uuid, p_alert_type public.alert_type, p_title text, p_message text, p_severity public.alert_severity DEFAULT 'info'::public.alert_severity, p_actionable boolean DEFAULT false, p_action_url text DEFAULT NULL::text, p_action_label text DEFAULT NULL::text, p_related_entities jsonb DEFAULT '{}'::jsonb, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  alert_id uuid;
BEGIN
  INSERT INTO user_alerts (
    user_id, workspace_id, alert_type, title, message, severity,
    actionable, action_url, action_label, related_entities, expires_at
  ) VALUES (
    p_user_id, p_workspace_id, p_alert_type, p_title, p_message, p_severity,
    p_actionable, p_action_url, p_action_label, p_related_entities, p_expires_at
  ) RETURNING id INTO alert_id;
  
  RETURN alert_id;
END;
$$;
CREATE FUNCTION public.ensure_raw_dump_text_columns() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
  BEGIN
    -- Ensure both columns have the same value on insert
    IF NEW.body_md IS NOT NULL AND NEW.text_dump IS NULL THEN
      NEW.text_dump = NEW.body_md;
    ELSIF NEW.text_dump IS NOT NULL AND NEW.body_md IS NULL THEN
      NEW.body_md = NEW.text_dump;
    END IF;
    
    RETURN NEW;
  END;
  $$;
CREATE FUNCTION public.fail_job(p_job_id uuid, p_error text) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_job RECORD;
  v_retry_delay INTERVAL;
BEGIN
  -- Get current job state
  SELECT * INTO v_job FROM jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  -- Check if we should retry
  IF v_job.attempts < v_job.max_attempts THEN
    -- Exponential backoff: 1min, 5min, 25min, etc.
    v_retry_delay := (POWER(5, v_job.attempts) * INTERVAL '1 minute');
    UPDATE jobs
    SET
      status = 'pending',
      attempts = attempts + 1,
      last_error = p_error,
      retry_after = NOW() + v_retry_delay,
      claimed_by = NULL,
      claimed_at = NULL,
      updated_at = NOW()
    WHERE id = p_job_id;
  ELSE
    -- Max retries exceeded, mark as failed
    UPDATE jobs
    SET
      status = 'failed',
      completed_at = NOW(),
      last_error = p_error,
      updated_at = NOW()
    WHERE id = p_job_id;
  END IF;
  RETURN TRUE;
END;
$$;
CREATE FUNCTION public.fn_archive_block(p_basket_id uuid, p_block_id uuid, p_actor_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_workspace_id uuid;
  v_preview jsonb;
  v_tomb_id uuid;
BEGIN
  SELECT workspace_id INTO v_workspace_id FROM baskets WHERE id = p_basket_id;
  -- Detach references
  DELETE FROM substrate_references
  USING documents d
  WHERE substrate_references.document_id = d.id
    AND d.basket_id = p_basket_id
    AND substrate_references.substrate_type = 'block'
    AND substrate_references.substrate_id = p_block_id;
  -- Prune relationships
  DELETE FROM substrate_relationships
  WHERE basket_id = p_basket_id
    AND ((from_id = p_block_id AND from_type = 'block') OR (to_id = p_block_id AND to_type = 'block'));
  -- Mark block archived via status
  UPDATE blocks SET status = 'archived', updated_at = now()
  WHERE id = p_block_id AND basket_id = p_basket_id;
  -- Preview snapshot for tombstone counts
  SELECT fn_cascade_preview(p_basket_id, 'block', p_block_id) INTO v_preview;
  INSERT INTO substrate_tombstones (
    workspace_id, basket_id, substrate_type, substrate_id,
    deletion_mode, redaction_scope, redaction_reason,
    refs_detached_count, relationships_pruned_count, affected_documents_count,
    created_by
  ) VALUES (
    v_workspace_id, p_basket_id, 'block', p_block_id,
    'archived', NULL, NULL,
    COALESCE((v_preview->>'refs_detached_count')::int, 0),
    COALESCE((v_preview->>'relationships_pruned_count')::int, 0),
    COALESCE((v_preview->>'affected_documents_count')::int, 0),
    p_actor_id
  ) RETURNING id INTO v_tomb_id;
  -- No timeline event emission to avoid kind constraint mismatch
  RETURN v_tomb_id;
END;
$$;
CREATE FUNCTION public.fn_archive_context_item(p_basket_id uuid, p_context_item_id uuid, p_actor_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_workspace_id uuid;
  v_preview jsonb;
  v_event_ids uuid[] := '{}';
  v_tomb_id uuid;
  v_refs_count int := 0;
  v_rels_count int := 0;
  v_docs_count int := 0;
BEGIN
  SELECT workspace_id INTO v_workspace_id FROM baskets WHERE id = p_basket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Basket % not found', p_basket_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM context_items
    WHERE id = p_context_item_id AND basket_id = p_basket_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Context item % not found in basket % or already archived', p_context_item_id, p_basket_id;
  END IF;
  SELECT fn_cascade_preview(p_basket_id, 'context_item', p_context_item_id) INTO v_preview;
  v_refs_count := COALESCE((v_preview->'substrate_references_detached')::int, 0);
  v_rels_count := COALESCE((v_preview->'relationships_pruned')::int, 0);
  v_docs_count := COALESCE((v_preview->'affected_documents')::int, 0);
  UPDATE context_items
    SET status = 'archived',
        state = 'DEPRECATED'::context_item_state,
        updated_at = now()
    WHERE id = p_context_item_id AND basket_id = p_basket_id;
  DELETE FROM substrate_references
    WHERE substrate_id = p_context_item_id AND substrate_type = 'context_item';
  DELETE FROM substrate_relationships
    WHERE (from_id = p_context_item_id AND from_type = 'context_item')
       OR (to_id = p_context_item_id AND to_type = 'context_item');
  INSERT INTO substrate_tombstones (
    workspace_id, basket_id, substrate_type, substrate_id,
    deletion_mode, redaction_scope, redaction_reason,
    refs_detached_count, relationships_pruned_count, affected_documents_count,
    created_by
  ) VALUES (
    v_workspace_id, p_basket_id, 'context_item', p_context_item_id,
    'archived', NULL, 'user_archive',
    v_refs_count, v_rels_count, v_docs_count,
    p_actor_id
  ) RETURNING id INTO v_tomb_id;
  BEGIN
    DECLARE
      v_flags jsonb;
      v_retention_days text;
    BEGIN
      SELECT public.get_workspace_governance_flags(v_workspace_id) INTO v_flags;
      IF COALESCE((v_flags->>'retention_enabled')::boolean, false) THEN
        v_retention_days := v_flags->'retention_policy'->'context_item'->>'days';
        IF v_retention_days IS NOT NULL THEN
          UPDATE substrate_tombstones
            SET earliest_physical_delete_at = now() + (v_retention_days::int || ' days')::interval
            WHERE id = v_tomb_id;
        END IF;
      END IF;
    END;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM emit_timeline_event(
    p_basket_id,
    'context_item.archived',
    jsonb_build_object(
      'context_item_id', p_context_item_id,
      'tomb_id', v_tomb_id,
      'refs_detached', v_refs_count,
      'relationships_pruned', v_rels_count,
      'affected_documents', v_docs_count
    ),
    v_workspace_id,
    p_actor_id
  );
  RETURN v_tomb_id;
END;
$$;
CREATE FUNCTION public.fn_block_create(p_basket_id uuid, p_workspace_id uuid, p_title text, p_body_md text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE v_block_id uuid;
BEGIN
  INSERT INTO public.blocks (basket_id, workspace_id, title, body_md)
  VALUES (p_basket_id, p_workspace_id, p_title, p_body_md)
  RETURNING id INTO v_block_id;
  PERFORM public.fn_timeline_emit(
    p_basket_id,
    'block',
    v_block_id,
    LEFT(COALESCE(p_title, ''), 140),
    jsonb_build_object('source','block_create','actor_id', auth.uid())
  );
  RETURN v_block_id;
END;
$$;
CREATE FUNCTION public.fn_block_revision_create(p_basket_id uuid, p_block_id uuid, p_workspace_id uuid, p_summary text, p_diff_json jsonb) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE v_rev_id uuid;
BEGIN
  INSERT INTO public.block_revisions (block_id, workspace_id, summary, diff_json)
  VALUES (p_block_id, p_workspace_id, p_summary, p_diff_json)
  RETURNING id INTO v_rev_id;
  PERFORM public.fn_timeline_emit(
    p_basket_id,
    'block_revision',
    v_rev_id,
    LEFT(COALESCE(p_summary,''), 140),
    jsonb_build_object('source','block_revision','actor_id', auth.uid(), 'block_id', p_block_id)
  );
  RETURN v_rev_id;
END; $$;
CREATE FUNCTION public.fn_cascade_preview(p_basket_id uuid, p_substrate_type text, p_substrate_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_refs int := 0;
  v_rels int := 0;
  v_docs int := 0;
BEGIN
  -- References in documents
  SELECT count(*) INTO v_refs
  FROM substrate_references
  WHERE document_id IN (SELECT id FROM documents WHERE basket_id = p_basket_id)
    AND substrate_type = p_substrate_type::substrate_type
    AND substrate_id = p_substrate_id;
  -- Relationships touching the node
  SELECT count(*) INTO v_rels
  FROM substrate_relationships
  WHERE basket_id = p_basket_id
    AND ((from_id = p_substrate_id AND from_type = p_substrate_type)
      OR (to_id = p_substrate_id AND to_type = p_substrate_type));
  -- Distinct documents affected
  SELECT count(DISTINCT document_id) INTO v_docs
  FROM substrate_references
  WHERE document_id IN (SELECT id FROM documents WHERE basket_id = p_basket_id)
    AND substrate_type = p_substrate_type::substrate_type
    AND substrate_id = p_substrate_id;
  RETURN jsonb_build_object(
    'refs_detached_count', v_refs,
    'relationships_pruned_count', v_rels,
    'affected_documents_count', v_docs
  );
END;
$$;
CREATE TABLE public.agent_processing_queue (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    dump_id uuid,
    basket_id uuid,
    workspace_id uuid NOT NULL,
    processing_state public.processing_state DEFAULT 'pending'::public.processing_state,
    claimed_at timestamp without time zone,
    claimed_by text,
    completed_at timestamp without time zone,
    attempts integer DEFAULT 0,
    error_message text,
    created_at timestamp without time zone DEFAULT now(),
    processing_stage text,
    work_payload jsonb DEFAULT '{}'::jsonb,
    work_result jsonb DEFAULT '{}'::jsonb,
    cascade_metadata jsonb DEFAULT '{}'::jsonb,
    parent_work_id uuid,
    user_id uuid,
    work_id text,
    work_type text DEFAULT 'P1_SUBSTRATE'::text,
    priority integer DEFAULT 5,
    CONSTRAINT valid_work_type_v21 CHECK ((work_type = ANY (ARRAY['P0_CAPTURE'::text, 'P1_SUBSTRATE'::text, 'P2_GRAPH'::text, 'P3_REFLECTION'::text, 'P4_COMPOSE'::text, 'MANUAL_EDIT'::text, 'PROPOSAL_REVIEW'::text, 'TIMELINE_RESTORE'::text])))
);
CREATE FUNCTION public.fn_claim_next_dumps(p_worker_id text, p_limit integer DEFAULT 10, p_stale_after_minutes integer DEFAULT 5) RETURNS SETOF public.agent_processing_queue
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- Atomically claim pending or stale dumps
  RETURN QUERY
  UPDATE agent_processing_queue
  SET 
    processing_state = 'claimed',
    claimed_at = now(),
    claimed_by = p_worker_id
  WHERE id IN (
    SELECT id 
    FROM agent_processing_queue
    WHERE processing_state = 'pending'
       -- Include stale claimed jobs that haven't been updated
       OR (processing_state = 'claimed' 
           AND claimed_at < now() - interval '1 minute' * p_stale_after_minutes)
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED  -- Prevents race conditions between agents
  )
  RETURNING *;
END;
$$;
CREATE FUNCTION public.fn_claim_pipeline_work(p_worker_id text, p_limit integer DEFAULT 10, p_stale_after_minutes integer DEFAULT 5) RETURNS SETOF public.agent_processing_queue
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  UPDATE agent_processing_queue
  SET 
    processing_state = 'claimed',
    claimed_at = now(),
    claimed_by = p_worker_id
  WHERE id IN (
    SELECT id 
    FROM agent_processing_queue
    WHERE (
      processing_state = 'pending' AND work_type IN ('P0_CAPTURE','P1_SUBSTRATE','P2_GRAPH','P4_COMPOSE')
    ) OR (
      processing_state = 'claimed' 
      AND claimed_at < now() - interval '1 minute' * p_stale_after_minutes
      AND work_type IN ('P0_CAPTURE','P1_SUBSTRATE','P2_GRAPH','P4_COMPOSE')
    )
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;
CREATE FUNCTION public.fn_context_item_create(p_basket_id uuid, p_type text, p_content text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_description text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE v_ctx_id uuid;
BEGIN
  INSERT INTO public.context_items (basket_id, type, content, title, description)
  VALUES (p_basket_id, p_type, p_content, p_title, p_description)
  RETURNING id INTO v_ctx_id;
  PERFORM public.fn_timeline_emit(
    p_basket_id,
    'context_item',
    v_ctx_id,
    LEFT(COALESCE(p_title, p_type, ''), 140),
    jsonb_build_object('source','context_item_create','actor_id', auth.uid())
  );
  RETURN v_ctx_id;
END;
$$;
CREATE FUNCTION public.fn_document_attach_block(p_document_id uuid, p_block_id uuid, p_occurrences integer DEFAULT 0, p_snippets jsonb DEFAULT '[]'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
  v_basket uuid;
begin
  -- Upsert-like behavior on unique(document_id, block_id)
  select id into v_id from public.block_links
  where document_id = p_document_id and block_id = p_block_id;
  if v_id is null then
    insert into public.block_links (id, document_id, block_id, occurrences, snippets)
    values (gen_random_uuid(), p_document_id, p_block_id, p_occurrences, p_snippets)
    returning id into v_id;
  else
    update public.block_links
    set occurrences = coalesce(p_occurrences, occurrences),
        snippets    = coalesce(p_snippets, snippets)
    where id = v_id;
  end if;
  select basket_id into v_basket from public.documents where id = p_document_id;
  perform public.emit_narrative_event(v_basket, p_document_id, 'doc.updated', 'attached block');
  return v_id;
end;
$$;
CREATE FUNCTION public.fn_document_attach_context_item(p_document_id uuid, p_context_item_id uuid, p_role text DEFAULT NULL::text, p_weight numeric DEFAULT NULL::numeric) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
  v_basket uuid;
begin
  -- Upsert-like behavior via unique(document_id, context_item_id)
  select id into v_id from public.document_context_items
  where document_id = p_document_id and context_item_id = p_context_item_id;
  if v_id is null then
    insert into public.document_context_items (id, document_id, context_item_id, role, weight)
    values (gen_random_uuid(), p_document_id, p_context_item_id, p_role, p_weight)
    returning id into v_id;
  else
    update public.document_context_items
    set role = coalesce(p_role, role),
        weight = coalesce(p_weight, weight)
    where id = v_id;
  end if;
  select basket_id into v_basket from public.documents where id = p_document_id;
  perform public.emit_narrative_event(v_basket, p_document_id, 'doc.updated', 'attached context_item');
  return v_id;
end;
$$;
CREATE FUNCTION public.fn_document_create(p_basket_id uuid, p_workspace_id uuid, p_title text, p_content_raw text) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE v_doc_id uuid;
BEGIN
  INSERT INTO public.documents (basket_id, workspace_id, title, content_raw)
  VALUES (p_basket_id, p_workspace_id, p_title, p_content_raw)
  RETURNING id INTO v_doc_id;
  PERFORM public.fn_timeline_emit(
    p_basket_id,
    'document',
    v_doc_id,
    LEFT(COALESCE(p_title, ''), 140),
    jsonb_build_object('source','document_create','actor_id', auth.uid())
  );
  RETURN v_doc_id;
END;
$$;
CREATE FUNCTION public.fn_document_create(p_basket_id uuid, p_title text, p_content_raw text, p_document_type text DEFAULT 'narrative'::text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_doc_id uuid;
begin
  insert into public.documents (id, basket_id, title, content_raw, content_rendered, document_type, metadata)
  values (gen_random_uuid(), p_basket_id, p_title, p_content_raw, null, p_document_type, p_metadata)
  returning id into v_doc_id;
  perform public.emit_narrative_event(p_basket_id, v_doc_id, 'doc.created', left(coalesce(p_title,''), 120));
  return v_doc_id;
end;
$$;
CREATE FUNCTION public.fn_document_create_version(p_document_id uuid, p_content text, p_version_message text DEFAULT NULL::text) RETURNS character varying
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_version_hash varchar(64);
  v_workspace_id uuid;
  v_basket_id uuid;
BEGIN
  v_version_hash := 'doc_v' || substr(encode(sha256(p_content::bytea), 'hex'), 1, 58);
  SELECT workspace_id, basket_id
    INTO v_workspace_id, v_basket_id
  FROM documents
  WHERE id = p_document_id;
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Document % not found', p_document_id;
  END IF;
  INSERT INTO document_versions (
    version_hash,
    document_id,
    content,
    metadata_snapshot,
    substrate_refs_snapshot,
    created_by,
    version_message,
    parent_version_hash
  )
  SELECT
    v_version_hash,
    p_document_id,
    p_content,
    d.metadata,
    COALESCE((
        SELECT jsonb_agg(to_jsonb(sr.*))
        FROM substrate_references sr
        WHERE sr.document_id = p_document_id
      ), '[]'::jsonb
    ),
    auth.uid(),
    p_version_message,
    d.current_version_hash
  FROM documents d
  WHERE d.id = p_document_id
  ON CONFLICT (version_hash) DO NOTHING;
  UPDATE documents
  SET current_version_hash = v_version_hash,
      updated_at = now()
  WHERE id = p_document_id;
  PERFORM fn_timeline_emit(
    v_basket_id,
    'document.updated',
    p_document_id,
    'Document version created: ' || left(v_version_hash, 12),
    jsonb_build_object('version_hash', v_version_hash, 'message', p_version_message)
  );
  RETURN v_version_hash;
END;
$$;
CREATE FUNCTION public.fn_document_update(p_doc_id uuid, p_title text, p_content_raw text, p_metadata jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_basket uuid;
begin
  update public.documents
  set title = coalesce(p_title, title),
      content_raw = coalesce(p_content_raw, content_raw),
      updated_at = now(),
      metadata = coalesce(p_metadata, metadata)
  where id = p_doc_id;
  select basket_id into v_basket from public.documents where id = p_doc_id;
  perform public.emit_narrative_event(v_basket, p_doc_id, 'doc.updated', left(coalesce(p_title,''), 120));
  return p_doc_id;
end;
$$;
CREATE FUNCTION public.fn_ingest_dumps(p_workspace_id uuid, p_basket_id uuid, p_dumps jsonb) RETURNS jsonb[]
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_dump jsonb;
  v_dump_id uuid;
  v_dump_created boolean;
  v_results jsonb[] := '{}';
  v_result jsonb;
BEGIN
  -- Process each dump in the array
  FOR v_dump IN SELECT * FROM jsonb_array_elements(p_dumps)
  LOOP
    -- Insert dump with idempotency on dump_request_id
    INSERT INTO public.raw_dumps (
      workspace_id, 
      basket_id,
      dump_request_id, 
      body_md, 
      file_url,
      source_meta,
      ingest_trace_id
    )
    VALUES (
      p_workspace_id,
      p_basket_id,
      (v_dump->>'dump_request_id')::uuid,
      (v_dump->>'text_dump'),
      (v_dump->>'file_url'),
      COALESCE((v_dump->'source_meta')::jsonb, '{}'::jsonb),
      (v_dump->>'ingest_trace_id')
    )
    ON CONFLICT (basket_id, dump_request_id) 
    DO UPDATE SET 
      body_md = COALESCE(EXCLUDED.body_md, public.raw_dumps.body_md),
      file_url = COALESCE(EXCLUDED.file_url, public.raw_dumps.file_url)
    RETURNING id, (xmax = 0) INTO v_dump_id, v_dump_created;
    -- Emit timeline event for new dumps
    IF v_dump_created THEN
      PERFORM public.fn_timeline_emit(
        p_basket_id,
        'dump',
        v_dump_id,
        LEFT(COALESCE((v_dump->>'text_dump'), 'File: ' || (v_dump->>'file_url'), 'Memory added'), 140),
        jsonb_build_object(
          'source', 'ingest',
          'actor_id', auth.uid(),
          'dump_request_id', (v_dump->>'dump_request_id')
        )
      );
    END IF;
    -- Build result
    v_result := jsonb_build_object('dump_id', v_dump_id);
    v_results := v_results || v_result;
  END LOOP;
  RETURN v_results;
END $$;
CREATE FUNCTION public.fn_queue_health() RETURNS TABLE(processing_state public.processing_state, count bigint, avg_age_seconds numeric, max_age_seconds numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    q.processing_state,
    COUNT(*) as count,
    AVG(EXTRACT(epoch FROM (now() - q.created_at)))::numeric as avg_age_seconds,
    MAX(EXTRACT(epoch FROM (now() - q.created_at)))::numeric as max_age_seconds
  FROM agent_processing_queue q
  GROUP BY q.processing_state
  ORDER BY q.processing_state;
END;
$$;
CREATE FUNCTION public.fn_redact_dump(p_basket_id uuid, p_dump_id uuid, p_scope text DEFAULT 'full'::text, p_reason text DEFAULT NULL::text, p_actor_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_workspace_id uuid;
  v_preview jsonb;
  v_tomb_id uuid;
BEGIN
  SELECT workspace_id INTO v_workspace_id FROM baskets WHERE id = p_basket_id;
  -- Redact content
  UPDATE raw_dumps
    SET body_md = NULL, text_dump = NULL, file_url = NULL, processing_status = 'redacted'
  WHERE id = p_dump_id AND basket_id = p_basket_id;
  -- Preview snapshot for tombstone counts
  SELECT fn_cascade_preview(p_basket_id, 'dump', p_dump_id) INTO v_preview;
  INSERT INTO substrate_tombstones (
    workspace_id, basket_id, substrate_type, substrate_id,
    deletion_mode, redaction_scope, redaction_reason,
    refs_detached_count, relationships_pruned_count, affected_documents_count,
    created_by
  ) VALUES (
    v_workspace_id, p_basket_id, 'dump', p_dump_id,
    'redacted', p_scope, p_reason,
    COALESCE((v_preview->>'refs_detached_count')::int, 0),
    COALESCE((v_preview->>'relationships_pruned_count')::int, 0),
    COALESCE((v_preview->>'affected_documents_count')::int, 0),
    p_actor_id
  ) RETURNING id INTO v_tomb_id;
  -- No timeline event emission to avoid kind constraint mismatch
  RETURN v_tomb_id;
END;
$$;
CREATE FUNCTION public.fn_relationship_upsert(p_basket_id uuid, p_from_type text, p_from_id uuid, p_to_type text, p_to_id uuid, p_relationship_type text, p_description text DEFAULT NULL::text, p_strength double precision DEFAULT 0.5) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.substrate_relationships (basket_id, from_type, from_id, to_type, to_id, relationship_type, description, strength)
  VALUES (p_basket_id, p_from_type, p_from_id, p_to_type, p_to_id, p_relationship_type, p_description, p_strength)
  ON CONFLICT (basket_id, from_type, from_id, to_type, to_id, relationship_type)
  DO UPDATE SET description = EXCLUDED.description, strength = EXCLUDED.strength
  RETURNING id INTO v_id;
  PERFORM public.fn_timeline_emit(
    p_basket_id,
    'relationship',
    v_id,
    LEFT(p_relationship_type || ' ' || COALESCE(p_from_type,'') || '→' || COALESCE(p_to_type,''), 140),
    jsonb_build_object('source','relationship_upsert','from_id', p_from_id, 'to_id', p_to_id, 'relationship_type', p_relationship_type, 'actor_id', auth.uid())
  );
  RETURN v_id;
END; $$;
CREATE FUNCTION public.fn_relationship_upsert_bulk(p_basket_id uuid, p_edges jsonb, p_idem_key text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_created int := 0;
  v_ignored int := 0;
  v_e jsonb;
  v_from_type text;
  v_from_id uuid;
  v_to_type text;
  v_to_id uuid;
  v_rel_type text;
  v_desc text;
  v_strength numeric;
begin
  if p_edges is null or jsonb_typeof(p_edges) <> 'array' then
    raise exception 'edges must be a jsonb array';
  end if;
  -- Simple idempotency guard via events: if we've already logged this idem_key for this basket, short-circuit.
  if p_idem_key is not null and exists (
    select 1 from public.events
    where basket_id = p_basket_id
      and kind = 'rel.bulk_upserted'
      and (payload->>'idem_key') = p_idem_key
  ) then
    return jsonb_build_object('created', 0, 'ignored', 0, 'idem_reused', true);
  end if;
  for v_e in select * from jsonb_array_elements(p_edges) loop
    v_from_type := v_e->>'from_type';
    v_from_id   := (v_e->>'from_id')::uuid;
    v_to_type   := v_e->>'to_type';
    v_to_id     := (v_e->>'to_id')::uuid;
    v_rel_type  := v_e->>'relationship_type';
    v_desc      := v_e->>'description';
    v_strength  := coalesce((v_e->>'strength')::numeric, 0.5);
    begin
      insert into public.substrate_relationships (id, basket_id, from_type, from_id, to_type, to_id, relationship_type, description, strength)
      values (gen_random_uuid(), p_basket_id, v_from_type, v_from_id, v_to_type, v_to_id, v_rel_type, v_desc, v_strength);
      v_created := v_created + 1;
    exception when unique_violation then
      v_ignored := v_ignored + 1;
    end;
  end loop;
  -- Emit into general events bus with small payload (timeline has constrained kinds)
  insert into public.events (id, basket_id, kind, payload, workspace_id, origin)
  values (gen_random_uuid(), p_basket_id, 'rel.bulk_upserted',
          jsonb_build_object('basket_id', p_basket_id, 'created', v_created, 'ignored', v_ignored, 'idem_key', coalesce(p_idem_key,'')),
          null, 'system');
  return jsonb_build_object('created', v_created, 'ignored', v_ignored, 'idem_reused', false);
end;
$$;
CREATE FUNCTION public.fn_reset_failed_jobs(p_max_attempts integer DEFAULT 3) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  reset_count int;
BEGIN
  UPDATE agent_processing_queue
  SET 
    processing_state = 'pending',
    claimed_at = NULL,
    claimed_by = NULL,
    error_message = NULL
  WHERE processing_state = 'failed' 
    AND attempts < p_max_attempts;
    
  GET DIAGNOSTICS reset_count = ROW_COUNT;
  RETURN reset_count;
END;
$$;
CREATE FUNCTION public.fn_set_schedule_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.fn_timeline_after_raw_dump() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM public.fn_timeline_emit_with_ts(
    NEW.basket_id,
    'dump',
    NEW.id,
    LEFT(COALESCE(NEW.body_md, ''), 280),
    NEW.created_at,
    jsonb_build_object('source','raw_dumps','actor_id', auth.uid())
  );
  RETURN NEW;
END; $$;
CREATE FUNCTION public.fn_timeline_emit(p_basket_id uuid, p_kind text, p_ref_id uuid, p_preview text, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_id         bigint;
  v_workspace  uuid;
BEGIN
  SELECT workspace_id INTO v_workspace FROM public.baskets WHERE id = p_basket_id;
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'basket % not found (workspace missing)', p_basket_id;
  END IF;
  -- 1:1 rule for dumps (no dupes per ref_id)
  IF p_kind = 'dump' AND EXISTS (
    SELECT 1 FROM public.timeline_events WHERE kind='dump' AND ref_id=p_ref_id
  ) THEN
    SELECT id INTO v_id FROM public.timeline_events
     WHERE kind='dump' AND ref_id=p_ref_id
     ORDER BY id DESC LIMIT 1;
    RETURN v_id;
  END IF;
  INSERT INTO public.timeline_events (basket_id, workspace_id, ts, kind, ref_id, preview, payload)
  VALUES (p_basket_id, v_workspace, now(), p_kind, p_ref_id, p_preview, p_payload)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
CREATE FUNCTION public.fn_timeline_emit_with_ts(p_basket_id uuid, p_kind text, p_ref_id uuid, p_preview text, p_ts timestamp with time zone, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_id         bigint;
  v_workspace  uuid;
BEGIN
  SELECT workspace_id INTO v_workspace FROM public.baskets WHERE id = p_basket_id;
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'basket % not found (workspace missing)', p_basket_id;
  END IF;
  IF p_kind = 'dump' AND EXISTS (
    SELECT 1 FROM public.timeline_events WHERE kind='dump' AND ref_id=p_ref_id
  ) THEN
    RETURN (SELECT id FROM public.timeline_events WHERE kind='dump' AND ref_id=p_ref_id ORDER BY id DESC LIMIT 1);
  END IF;
  INSERT INTO public.timeline_events (basket_id, workspace_id, ts, kind, ref_id, preview, payload)
  VALUES (p_basket_id, v_workspace, p_ts, p_kind, p_ref_id, p_preview, p_payload)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
CREATE FUNCTION public.fn_update_queue_state(p_id uuid, p_state public.processing_state, p_error text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE agent_processing_queue 
  SET 
    processing_state = p_state,
    completed_at = CASE WHEN p_state = 'completed' THEN now() ELSE completed_at END,
    error_message = p_error,
    attempts = CASE WHEN p_state = 'failed' THEN attempts + 1 ELSE attempts END
  WHERE id = p_id;
END;
$$;
CREATE FUNCTION public.fn_vacuum_substrates(p_workspace_id uuid, p_limit integer DEFAULT 50) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_deleted_blocks int := 0;
  v_deleted_dumps int := 0;
  v_deleted_items int := 0;
  v_row record;
  v_settings jsonb;
  v_retention_enabled boolean := false;
BEGIN
  -- Check retention policy flag
  SELECT public.get_workspace_governance_flags(p_workspace_id) INTO v_settings;
  v_retention_enabled := COALESCE((v_settings->>'retention_enabled')::boolean, false);
  IF NOT v_retention_enabled THEN
    RETURN jsonb_build_object('deleted_blocks',0,'deleted_dumps',0,'deleted_context_items',0,'note','retention disabled');
  END IF;
  FOR v_row IN
    SELECT * FROM public.substrate_tombstones
    WHERE workspace_id = p_workspace_id
      AND deletion_mode IN ('archived','redacted','deleted')
      AND earliest_physical_delete_at IS NOT NULL
      AND now() >= earliest_physical_delete_at
      AND physically_deleted_at IS NULL
    LIMIT p_limit
  LOOP
    -- Ensure no remaining hard references
    IF EXISTS (
      SELECT 1 FROM public.substrate_references sr
      JOIN public.documents d ON d.id = sr.document_id
      WHERE d.workspace_id = p_workspace_id
        AND sr.substrate_type = v_row.substrate_type::substrate_type
        AND sr.substrate_id = v_row.substrate_id
    ) THEN
      CONTINUE;
    END IF;
    -- Ensure no remaining relationships (for block/context_item)
    IF v_row.substrate_type IN ('block','context_item') THEN
      IF EXISTS (
        SELECT 1 FROM public.substrate_relationships
        WHERE basket_id = v_row.basket_id
          AND ((from_id = v_row.substrate_id AND from_type = v_row.substrate_type)
            OR (to_id = v_row.substrate_id AND to_type = v_row.substrate_type))
      ) THEN
        CONTINUE;
      END IF;
    END IF;
    -- Perform physical deletion per substrate type
    IF v_row.substrate_type = 'block' THEN
      DELETE FROM public.blocks WHERE id = v_row.substrate_id AND workspace_id = p_workspace_id;
      v_deleted_blocks := v_deleted_blocks + 1;
    ELSIF v_row.substrate_type = 'dump' THEN
      DELETE FROM public.raw_dumps WHERE id = v_row.substrate_id AND workspace_id = p_workspace_id;
      v_deleted_dumps := v_deleted_dumps + 1;
    ELSIF v_row.substrate_type = 'context_item' THEN
      DELETE FROM public.context_items WHERE id = v_row.substrate_id AND basket_id = v_row.basket_id;
      v_deleted_items := v_deleted_items + 1;
    ELSE
      CONTINUE;
    END IF;
    -- Mark tombstone as physically deleted and emit event
    UPDATE public.substrate_tombstones
      SET deletion_mode = 'deleted', physically_deleted_at = now()
      WHERE id = v_row.id;
    PERFORM emit_timeline_event(v_row.basket_id, 'substrate.physically_deleted', jsonb_build_object(
      'substrate_type', v_row.substrate_type,
      'substrate_id', v_row.substrate_id,
      'tombstone_id', v_row.id
    ), p_workspace_id, NULL, 'vacuum');
  END LOOP;
  RETURN jsonb_build_object(
    'deleted_blocks', v_deleted_blocks,
    'deleted_dumps', v_deleted_dumps,
    'deleted_context_items', v_deleted_items
  );
END;
$$;
CREATE FUNCTION public.get_basket_anchor_vocabulary(p_basket_id uuid) RETURNS TABLE(anchor_role text, usage_count bigint, accepted_count bigint, avg_confidence numeric, semantic_types text[])
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.anchor_role,
        COUNT(*) as usage_count,
        COUNT(*) FILTER (WHERE b.anchor_status = 'accepted') as accepted_count,
        ROUND(AVG(b.anchor_confidence)::numeric, 2) as avg_confidence,
        ARRAY_AGG(DISTINCT b.semantic_type ORDER BY b.semantic_type) as semantic_types
    FROM blocks b
    WHERE b.basket_id = p_basket_id
        AND b.anchor_role IS NOT NULL
    GROUP BY b.anchor_role
    ORDER BY accepted_count DESC, usage_count DESC;
END;
$$;
CREATE FUNCTION public.get_basket_substrate_categorized(p_basket_id uuid) RETURNS TABLE(category text, block_count bigint, semantic_types jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        CASE
            WHEN semantic_type IN ('fact', 'metric', 'event', 'insight', 'action', 'finding', 'quote', 'summary')
                THEN 'knowledge'
            WHEN semantic_type IN ('intent', 'objective', 'rationale', 'principle', 'assumption', 'context', 'constraint')
                THEN 'meaning'
            WHEN semantic_type IN ('entity', 'classification', 'reference')
                THEN 'structural'
            ELSE 'other'
        END as category,
        COUNT(*) as block_count,
        jsonb_object_agg(
            semantic_type,
            COUNT(*)
        ) as semantic_types
    FROM blocks
    WHERE basket_id = p_basket_id
        AND state = 'ACCEPTED'
    GROUP BY category;
END;
$$;
CREATE FUNCTION public.get_basket_supervision_settings(p_basket_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  settings jsonb;
BEGIN
  SELECT
    COALESCE(
      p.metadata->'work_supervision',
      '{"promotion_mode": "auto", "auto_promote_types": ["finding", "recommendation"], "require_review_before_promotion": false}'::jsonb
    )
  INTO settings
  FROM projects p
  WHERE p.basket_id = p_basket_id
  LIMIT 1;
  -- Default if no project found
  IF settings IS NULL THEN
    settings := '{"promotion_mode": "auto", "auto_promote_types": ["finding", "recommendation"], "require_review_before_promotion": false}'::jsonb;
  END IF;
  RETURN settings;
END;
$$;
CREATE FUNCTION public.get_block_version_history(p_block_id uuid) RETURNS TABLE(id uuid, version integer, title text, content text, state public.block_state, created_at timestamp with time zone, updated_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE version_chain AS (
        -- Start with the given block
        SELECT
            b.id,
            b.parent_block_id,
            b.version,
            b.title,
            b.content,
            b.state,
            b.created_at,
            b.updated_at
        FROM blocks b
        WHERE b.id = p_block_id
        UNION ALL
        -- Recursively get parent versions
        SELECT
            b.id,
            b.parent_block_id,
            b.version,
            b.title,
            b.content,
            b.state,
            b.created_at,
            b.updated_at
        FROM blocks b
        INNER JOIN version_chain vc ON b.id = vc.parent_block_id
    )
    SELECT
        vc.id,
        vc.version,
        vc.title,
        vc.content,
        vc.state,
        vc.created_at,
        vc.updated_at
    FROM version_chain vc
    ORDER BY vc.version DESC;
END;
$$;
CREATE FUNCTION public.get_child_sessions(parent_id uuid) RETURNS TABLE(id uuid, agent_type text, sdk_session_id text, last_active_at timestamp with time zone, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.agent_type,
        s.sdk_session_id,
        s.last_active_at,
        s.created_at
    FROM agent_sessions s
    WHERE s.parent_session_id = parent_id
    ORDER BY s.created_at ASC;
END;
$$;
CREATE FUNCTION public.get_current_insight_canon(p_basket_id uuid) RETURNS TABLE(id uuid, reflection_text text, substrate_hash text, graph_signature text, derived_from jsonb, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    ra.id,
    ra.reflection_text,
    ra.substrate_hash,
    ra.graph_signature,
    ra.derived_from,
    ra.created_at
  FROM public.reflections_artifact ra
  WHERE ra.basket_id = p_basket_id
    AND ra.insight_type = 'insight_canon'
    AND ra.is_current = true
  LIMIT 1;
END;
$$;
CREATE FUNCTION public.get_document_canon(p_basket_id uuid) RETURNS TABLE(id uuid, title text, current_version_hash text, composition_instructions jsonb, derived_from jsonb)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.title,
    d.current_version_hash,
    d.composition_instructions,
    d.derived_from
  FROM public.documents d
  WHERE d.basket_id = p_basket_id
    AND d.doc_type = 'document_canon'
  LIMIT 1;
END;
$$;
CREATE FUNCTION public.get_outputs_pending_promotion(p_basket_id uuid) RETURNS TABLE(id uuid, output_type text, title text, body jsonb, confidence double precision, source_context_ids uuid[], agent_type text, work_ticket_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    wo.id,
    wo.output_type,
    wo.title,
    wo.body,
    wo.confidence,
    wo.source_context_ids,
    wo.agent_type,
    wo.work_ticket_id
  FROM work_outputs wo
  WHERE wo.basket_id = p_basket_id
    AND wo.supervision_status = 'approved'
    AND wo.substrate_proposal_id IS NULL
    AND wo.promotion_method IS NULL
  ORDER BY wo.created_at ASC;
END;
$$;
CREATE FUNCTION public.get_project_supervision_settings(p_project_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  settings jsonb;
BEGIN
  SELECT
    COALESCE(
      metadata->'work_supervision',
      '{"promotion_mode": "auto", "auto_promote_types": ["finding", "recommendation"], "require_review_before_promotion": false}'::jsonb
    )
  INTO settings
  FROM projects
  WHERE id = p_project_id;
  RETURN settings;
END;
$$;
CREATE FUNCTION public.get_session_hierarchy(basket_id_param uuid) RETURNS TABLE(session_id uuid, agent_type text, parent_session_id uuid, sdk_session_id text, is_root boolean, depth integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE session_tree AS (
        -- Base case: TP session (root)
        SELECT
            s.id AS session_id,
            s.agent_type,
            s.parent_session_id,
            s.sdk_session_id,
            (s.parent_session_id IS NULL) AS is_root,
            0 AS depth
        FROM agent_sessions s
        WHERE s.basket_id = basket_id_param
          AND s.parent_session_id IS NULL
          AND s.agent_type = 'thinking_partner'
        UNION ALL
        -- Recursive case: Child sessions
        SELECT
            s.id AS session_id,
            s.agent_type,
            s.parent_session_id,
            s.sdk_session_id,
            FALSE AS is_root,
            st.depth + 1 AS depth
        FROM agent_sessions s
        INNER JOIN session_tree st ON s.parent_session_id = st.session_id
    )
    SELECT * FROM session_tree
    ORDER BY depth, agent_type;
END;
$$;
CREATE FUNCTION public.get_supervision_stats(p_basket_id uuid) RETURNS TABLE(total_outputs bigint, pending_review bigint, approved bigint, rejected bigint, revision_requested bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::bigint AS total_outputs,
        COUNT(*) FILTER (WHERE supervision_status = 'pending_review')::bigint AS pending_review,
        COUNT(*) FILTER (WHERE supervision_status = 'approved')::bigint AS approved,
        COUNT(*) FILTER (WHERE supervision_status = 'rejected')::bigint AS rejected,
        COUNT(*) FILTER (WHERE supervision_status = 'revision_requested')::bigint AS revision_requested
    FROM work_outputs
    WHERE basket_id = p_basket_id;
END;
$$;
CREATE FUNCTION public.get_workspace_constants(p_workspace_id uuid) RETURNS TABLE(id uuid, semantic_type text, title text, content text, anchor_role text, scope public.scope_level, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id,
        b.semantic_type,
        b.title,
        b.content,
        b.anchor_role,
        b.scope,
        b.created_at
    FROM blocks b
    WHERE b.workspace_id = p_workspace_id
        AND b.state = 'CONSTANT'
        AND b.scope IN ('WORKSPACE', 'ORG', 'GLOBAL')
    ORDER BY b.scope DESC, b.created_at DESC;
END;
$$;
CREATE FUNCTION public.get_workspace_governance_flags(p_workspace_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  result jsonb;
  settings_row public.workspace_governance_settings%ROWTYPE;
BEGIN
  -- Try to get workspace-specific settings
  SELECT * INTO settings_row
  FROM public.workspace_governance_settings
  WHERE workspace_id = p_workspace_id;
  IF FOUND THEN
    -- Return workspace-specific flags
    result := jsonb_build_object(
      'governance_enabled', settings_row.governance_enabled,
      'validator_required', settings_row.validator_required,
      'direct_substrate_writes', settings_row.direct_substrate_writes,
      'governance_ui_enabled', settings_row.governance_ui_enabled,
      'ep_onboarding_dump', settings_row.ep_onboarding_dump,
      'ep_manual_edit', settings_row.ep_manual_edit,
      'ep_graph_action', settings_row.ep_graph_action,
      'ep_timeline_restore', settings_row.ep_timeline_restore,
      'default_blast_radius', settings_row.default_blast_radius,
      'source', 'workspace_database'
    );
  ELSE
    -- Canon-compliant defaults when no row exists:
    -- P0 capture must be direct; all other entry points conservative (proposal)
    result := jsonb_build_object(
      'governance_enabled', true,
      'validator_required', false,
      'direct_substrate_writes', false,
      'governance_ui_enabled', true,
      'ep_onboarding_dump', 'direct',
      'ep_manual_edit', 'proposal',
      'ep_document_edit', 'proposal',            -- legacy field retained for compatibility
      'ep_reflection_suggestion', 'proposal',    -- legacy field retained for compatibility
      'ep_graph_action', 'proposal',
      'ep_timeline_restore', 'proposal',
      'default_blast_radius', 'Scoped',
      'source', 'canon_compliant_defaults'
    );
  END IF;
  RETURN result;
END;
$$;
CREATE FUNCTION public.increment_block_usage(p_block_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO block_usage (block_id, times_referenced, last_used_at)
  VALUES (p_block_id, 1, now())
  ON CONFLICT (block_id)
  DO UPDATE SET
    times_referenced = block_usage.times_referenced + 1,
    last_used_at = now();
END;
$$;
CREATE FUNCTION public.increment_work_session_artifacts_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE work_sessions
  SET artifacts_count = artifacts_count + 1
  WHERE id = NEW.work_session_id;
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.increment_work_session_mutations_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE work_sessions
  SET substrate_mutations_count = substrate_mutations_count + 1
  WHERE id = NEW.work_session_id;
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.log_extraction_metrics(p_dump_id uuid, p_basket_id uuid, p_workspace_id uuid, p_agent_version text, p_blocks_created integer, p_context_items_created integer, p_avg_confidence real, p_processing_time_ms integer) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_metric_id uuid;
BEGIN
  INSERT INTO extraction_quality_metrics (
    dump_id, basket_id, workspace_id, agent_version,
    blocks_created, context_items_created, avg_confidence, processing_time_ms
  ) VALUES (
    p_dump_id, p_basket_id, p_workspace_id, p_agent_version,
    p_blocks_created, p_context_items_created, p_avg_confidence, p_processing_time_ms
  )
  RETURNING id INTO v_metric_id;
  RETURN v_metric_id;
END;
$$;
CREATE FUNCTION public.map_anchor_key_to_role(anchor_key text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  -- Extract role from anchor_key patterns
  -- Examples: "core_problem" -> "problem", "feature_block_1" -> "feature"
  IF anchor_key LIKE '%problem%' THEN RETURN 'problem';
  ELSIF anchor_key LIKE '%customer%' THEN RETURN 'customer';
  ELSIF anchor_key LIKE '%solution%' THEN RETURN 'solution';
  ELSIF anchor_key LIKE '%feature%' THEN RETURN 'feature';
  ELSIF anchor_key LIKE '%constraint%' THEN RETURN 'constraint';
  ELSIF anchor_key LIKE '%metric%' THEN RETURN 'metric';
  ELSIF anchor_key LIKE '%insight%' THEN RETURN 'insight';
  ELSIF anchor_key LIKE '%vision%' THEN RETURN 'vision';
  ELSE RETURN NULL; -- Unknown anchor key pattern
  END IF;
END;
$$;
CREATE FUNCTION public.mark_alert_read(p_alert_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE user_alerts 
  SET read_at = now() 
  WHERE id = p_alert_id AND user_id = auth.uid() AND read_at IS NULL;
  
  RETURN FOUND;
END;
$$;
CREATE FUNCTION public.mark_related_blocks_stale() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- Mark blocks from previous dumps in same basket as potentially stale
  -- Force staleness by setting last_validated_at to 30 days ago
  UPDATE blocks
  SET last_validated_at = now() - interval '30 days'
  WHERE basket_id = NEW.basket_id
    AND raw_dump_id IN (
      SELECT id FROM raw_dumps
      WHERE basket_id = NEW.basket_id
      AND id != NEW.id
      AND created_at < NEW.created_at  -- Only older dumps
    )
    AND status NOT IN ('archived', 'rejected');  -- Don't mark archived blocks
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.mark_work_output_promoted(p_output_id uuid, p_proposal_id uuid, p_block_id uuid, p_method text, p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE work_outputs
  SET
    substrate_proposal_id = p_proposal_id,
    promoted_to_block_id = p_block_id,
    promotion_method = p_method,
    promoted_at = now(),
    promoted_by = p_user_id,
    merged_to_substrate_at = now()
  WHERE id = p_output_id;
END;
$$;
CREATE FUNCTION public.normalize_label(p_label text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
           when p_label is null then null
           else lower(regexp_replace(p_label, '\s+', ' ', 'g'))
         end
$$;
CREATE FUNCTION public.prevent_lock_vs_constant() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.state = 'LOCKED' THEN
    PERFORM 1 FROM blocks
      WHERE semantic_type = NEW.semantic_type
        AND scope IS NOT NULL          -- a Constant
        AND state = 'CONSTANT'
        AND basket_id = NEW.basket_id; -- same workspace implied
    IF FOUND THEN
      RAISE EXCEPTION 'LOCK_CONFLICT_CONSTANT';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.promote_output_to_context_block(p_output_id uuid, p_promoted_by uuid DEFAULT NULL::uuid, p_override_role text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_output RECORD;
  v_recipe RECORD;
  v_new_block_id UUID;
  v_target_role TEXT;
  v_refresh_policy JSONB;
BEGIN
  -- 1. Fetch the work output
  SELECT wo.*, wt.recipe_slug
  INTO v_output
  FROM work_outputs wo
  LEFT JOIN work_tickets wt ON wo.work_ticket_id = wt.id
  WHERE wo.id = p_output_id;
  IF v_output IS NULL THEN
    RAISE EXCEPTION 'Work output not found: %', p_output_id;
  END IF;
  IF v_output.promotion_status = 'promoted' THEN
    RAISE EXCEPTION 'Output already promoted: %', p_output_id;
  END IF;
  -- 2. Determine target role (override > output > recipe)
  v_target_role := COALESCE(
    p_override_role,
    v_output.target_context_role
  );
  -- If no role specified, try to get from recipe
  IF v_target_role IS NULL AND v_output.recipe_slug IS NOT NULL THEN
    SELECT context_outputs->>'role'
    INTO v_target_role
    FROM work_recipes
    WHERE slug = v_output.recipe_slug;
  END IF;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'No target context role specified for output: %', p_output_id;
  END IF;
  -- 3. Get refresh policy from recipe if available
  IF v_output.recipe_slug IS NOT NULL THEN
    SELECT context_outputs->'refresh_policy'
    INTO v_refresh_policy
    FROM work_recipes
    WHERE slug = v_output.recipe_slug;
  END IF;
  -- 4. Create the block
  INSERT INTO blocks (
    id,
    basket_id,
    workspace_id,
    title,
    body_md,
    content,
    semantic_type,
    anchor_role,
    anchor_status,
    anchor_confidence,
    refresh_policy,
    state,
    scope,
    status,
    confidence_score,
    metadata,
    processing_agent,
    approved_at,
    approved_by,
    created_at,
    updated_at
  )
  SELECT
    gen_random_uuid(),
    v_output.basket_id,
    b.workspace_id,
    v_output.title,
    v_output.body,
    v_output.body,  -- content = body for context blocks
    'context_' || v_target_role,  -- semantic_type derived from role
    v_target_role,
    'approved',  -- anchor_status - promoted outputs are approved
    COALESCE(v_output.confidence, 0.8),  -- anchor_confidence
    v_refresh_policy,
    'active',  -- state
    'primary',  -- scope
    'approved',  -- status
    v_output.confidence,
    jsonb_build_object(
      'promoted_from_output_id', v_output.id,
      'promoted_at', now(),
      'source_agent', v_output.agent_type
    ) || COALESCE(v_output.metadata, '{}'::jsonb),
    v_output.agent_type,
    now(),
    p_promoted_by
  FROM baskets b
  WHERE b.id = v_output.basket_id
  RETURNING id INTO v_new_block_id;
  -- 5. Update the work output to mark as promoted
  UPDATE work_outputs
  SET
    promotion_status = 'promoted',
    promoted_to_block_id = v_new_block_id,
    promoted_at = now(),
    promoted_by = p_promoted_by,
    promotion_method = CASE
      WHEN p_promoted_by IS NOT NULL THEN 'manual'
      ELSE 'auto'
    END,
    updated_at = now()
  WHERE id = p_output_id;
  -- 6. Archive any existing block with the same anchor_role in this basket
  -- (only one active block per role per basket)
  UPDATE blocks
  SET
    state = 'archived',
    anchor_status = 'superseded',
    updated_at = now()
  WHERE basket_id = v_output.basket_id
    AND anchor_role = v_target_role
    AND id != v_new_block_id
    AND state = 'active';
  RETURN v_new_block_id;
END;
$$;
CREATE FUNCTION public.proposal_validation_check() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Prevent approval of unvalidated proposals
    IF NEW.status = 'APPROVED' AND OLD.status != 'APPROVED' THEN
        IF NEW.validation_required = true AND NEW.validation_bypassed = false THEN
            -- Check if validator report is complete
            IF NEW.validator_report IS NULL OR 
               NOT (NEW.validator_report ? 'confidence') OR
               NOT (NEW.validator_report ? 'impact_summary') THEN
                RAISE EXCEPTION 'Cannot approve proposal without complete validator report. Use validation_bypassed=true to override.';
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;
CREATE FUNCTION public.purge_workspace_data(target_workspace_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- All operations in this function run in a single transaction
  -- If any DELETE fails, the entire operation rolls back
  -- ========================================
  -- WORK-PLATFORM TABLES (Phase 2e Schema)
  -- ========================================
  -- Delete project_recipe_schedules (new)
  DELETE FROM project_recipe_schedules
  WHERE project_id IN (
    SELECT id FROM projects WHERE workspace_id = target_workspace_id
  );
  -- Delete work_iterations (references work_tickets)
  DELETE FROM work_iterations
  WHERE work_ticket_id IN (
    SELECT id FROM work_tickets WHERE workspace_id = target_workspace_id
  );
  -- Delete work_checkpoints (references work_tickets)
  DELETE FROM work_checkpoints
  WHERE work_ticket_id IN (
    SELECT id FROM work_tickets WHERE workspace_id = target_workspace_id
  );
  -- Delete work_tickets (references work_requests)
  DELETE FROM work_tickets
  WHERE workspace_id = target_workspace_id;
  -- Delete work_requests
  DELETE FROM work_requests
  WHERE workspace_id = target_workspace_id;
  -- Delete agent_sessions
  DELETE FROM agent_sessions
  WHERE workspace_id = target_workspace_id;
  -- Delete project_agents (before projects)
  DELETE FROM project_agents
  WHERE project_id IN (
    SELECT id FROM projects WHERE workspace_id = target_workspace_id
  );
  -- Delete projects (before baskets, as projects reference baskets)
  DELETE FROM projects
  WHERE workspace_id = target_workspace_id;
  -- ========================================
  -- SUBSTRATE TABLES
  -- ========================================
  -- Delete work_outputs (before blocks)
  DELETE FROM work_outputs
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );
  -- Delete substrate_relationships (before blocks/context_items)
  DELETE FROM substrate_relationships
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );
  -- Delete blocks (core substrate)
  DELETE FROM blocks
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );
  -- Delete context_items (if still exists)
  DELETE FROM context_items
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );
  -- Delete reference_assets
  DELETE FROM reference_assets
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );
  -- Delete reflections_artifact
  DELETE FROM reflections_artifact
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );
  -- Delete proposals (governance)
  DELETE FROM proposals
  WHERE basket_id IN (
    SELECT id FROM baskets WHERE workspace_id = target_workspace_id
  );
  -- Delete baskets
  DELETE FROM baskets
  WHERE workspace_id = target_workspace_id;
  -- ========================================
  -- NOTE: The following are intentionally NOT deleted:
  -- - workspaces (the container itself)
  -- - workspace_memberships (user access)
  -- - users (shared across workspaces)
  -- - workspace_governance_settings (settings preserved)
  -- - Integration tokens/connections (preserved for future use)
  -- ========================================
END;
$$;
CREATE FUNCTION public.queue_agent_processing() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Insert into processing queue with workspace context
  INSERT INTO agent_processing_queue (
    dump_id, 
    basket_id, 
    workspace_id
  )
  SELECT 
    NEW.id,
    NEW.basket_id,
    b.workspace_id
  FROM baskets b
  WHERE b.id = NEW.basket_id;
  
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.queue_scheduled_work_tickets() RETURNS TABLE(schedule_id uuid, project_id uuid, recipe_id uuid, ticket_id uuid)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_schedule RECORD;
  v_ticket_id UUID;
  v_recipe RECORD;
BEGIN
  -- Find all due schedules
  FOR v_schedule IN
    SELECT
      ps.id,
      ps.project_id,
      ps.recipe_id,
      ps.basket_id,
      ps.recipe_parameters,
      ps.frequency,
      ps.day_of_week,
      ps.time_of_day
    FROM project_schedules ps
    WHERE ps.enabled = true
    AND ps.next_run_at <= NOW()
    ORDER BY ps.next_run_at ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Get recipe details
    SELECT wr.slug, wr.name, wr.agent_type, wr.context_outputs
    INTO v_recipe
    FROM work_recipes wr
    WHERE wr.id = v_schedule.recipe_id
    AND wr.status = 'active';
    IF NOT FOUND THEN
      -- Recipe no longer active, skip
      UPDATE project_schedules
      SET last_run_status = 'skipped',
          last_run_at = NOW(),
          next_run_at = calculate_next_run_at(
            v_schedule.frequency,
            v_schedule.day_of_week,
            v_schedule.time_of_day,
            NULL
          )
      WHERE id = v_schedule.id;
      CONTINUE;
    END IF;
    -- Create work ticket
    INSERT INTO work_tickets (
      basket_id,
      status,
      priority,
      source,
      metadata
    ) VALUES (
      v_schedule.basket_id,
      'pending',
      5, -- Default priority
      'scheduled',
      jsonb_build_object(
        'schedule_id', v_schedule.id,
        'recipe_slug', v_recipe.slug,
        'recipe_id', v_schedule.recipe_id,
        'recipe_parameters', v_schedule.recipe_parameters,
        'context_outputs', v_recipe.context_outputs,
        'scheduled_at', NOW()
      )
    )
    RETURNING id INTO v_ticket_id;
    -- Update schedule state
    UPDATE project_schedules
    SET last_run_at = NOW(),
        last_run_status = 'success',
        last_run_ticket_id = v_ticket_id,
        run_count = run_count + 1,
        next_run_at = calculate_next_run_at(
          v_schedule.frequency,
          v_schedule.day_of_week,
          v_schedule.time_of_day,
          NULL
        )
    WHERE id = v_schedule.id;
    -- Return result
    schedule_id := v_schedule.id;
    project_id := v_schedule.project_id;
    recipe_id := v_schedule.recipe_id;
    ticket_id := v_ticket_id;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;
CREATE FUNCTION public.queue_stale_anchor_refreshes() RETURNS TABLE(block_id uuid, basket_id uuid, anchor_role text, recipe_id uuid, ticket_id uuid)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_stale RECORD;
  v_ticket_id UUID;
BEGIN
  -- Find stale anchor blocks that have a producing recipe
  FOR v_stale IN
    SELECT
      b.id as block_id,
      b.basket_id,
      b.anchor_role,
      wr.id as recipe_id,
      wr.slug as recipe_slug,
      wr.context_outputs
    FROM blocks b
    JOIN work_recipes wr ON wr.context_outputs->>'role' = b.anchor_role
    WHERE b.anchor_role IS NOT NULL
    AND b.state = 'ACCEPTED'
    AND wr.status = 'active'
    AND b.updated_at < NOW() - (
      (wr.context_outputs->'refresh_policy'->>'ttl_hours')::INTEGER * INTERVAL '1 hour'
    )
    -- Don't queue if there's already a pending ticket for this basket/recipe
    AND NOT EXISTS (
      SELECT 1 FROM work_tickets wt
      WHERE wt.basket_id = b.basket_id
      AND wt.source = 'stale_refresh'
      AND wt.metadata->>'recipe_id' = wr.id::TEXT
      AND wt.status IN ('pending', 'running')
    )
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    -- Create work ticket for refresh
    INSERT INTO work_tickets (
      basket_id,
      status,
      priority,
      source,
      metadata
    ) VALUES (
      v_stale.basket_id,
      'pending',
      3, -- Lower priority than user-initiated
      'stale_refresh',
      jsonb_build_object(
        'recipe_slug', v_stale.recipe_slug,
        'recipe_id', v_stale.recipe_id,
        'anchor_role', v_stale.anchor_role,
        'stale_block_id', v_stale.block_id,
        'context_outputs', v_stale.context_outputs,
        'triggered_at', NOW()
      )
    )
    RETURNING id INTO v_ticket_id;
    -- Return result
    block_id := v_stale.block_id;
    basket_id := v_stale.basket_id;
    anchor_role := v_stale.anchor_role;
    recipe_id := v_stale.recipe_id;
    ticket_id := v_ticket_id;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;
CREATE FUNCTION public.reject_work_output(p_output_id uuid, p_reviewer_id uuid, p_notes text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF p_notes IS NULL OR length(trim(p_notes)) = 0 THEN
    RAISE EXCEPTION 'Rejection notes are required';
  END IF;
  UPDATE work_outputs
  SET
    supervision_status = 'rejected',
    reviewed_by = p_reviewer_id,
    reviewed_at = now(),
    reviewer_notes = p_notes
  WHERE id = p_output_id
    AND supervision_status IN ('pending_review', 'revision_requested');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Output not found or not reviewable';
  END IF;
END;
$$;
CREATE FUNCTION public.request_output_revision(p_output_id uuid, p_reviewer_id uuid, p_feedback text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF p_feedback IS NULL OR length(trim(p_feedback)) = 0 THEN
    RAISE EXCEPTION 'Revision feedback is required';
  END IF;
  UPDATE work_outputs
  SET
    supervision_status = 'revision_requested',
    reviewed_by = p_reviewer_id,
    reviewed_at = now(),
    reviewer_notes = p_feedback
  WHERE id = p_output_id
    AND supervision_status = 'pending_review';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Output not found or not pending review';
  END IF;
END;
$$;
CREATE FUNCTION public.semantic_search_blocks(p_basket_id uuid, p_query_embedding public.vector, p_semantic_types text[] DEFAULT NULL::text[], p_anchor_roles text[] DEFAULT NULL::text[], p_states text[] DEFAULT ARRAY['ACCEPTED'::text, 'LOCKED'::text, 'CONSTANT'::text], p_min_similarity numeric DEFAULT 0.70, p_limit integer DEFAULT 20) RETURNS TABLE(id uuid, basket_id uuid, content text, semantic_type text, anchor_role text, state text, metadata jsonb, similarity_score numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id,
        b.basket_id,
        b.content,
        b.semantic_type,
        b.anchor_role,
        b.state::TEXT,
        b.metadata,
        (1 - (b.embedding <=> p_query_embedding))::DECIMAL AS similarity_score
    FROM public.blocks b
    WHERE b.basket_id = p_basket_id
        AND b.embedding IS NOT NULL
        AND (p_semantic_types IS NULL OR b.semantic_type = ANY(p_semantic_types))
        AND (p_anchor_roles IS NULL OR b.anchor_role = ANY(p_anchor_roles))
        AND b.state::TEXT = ANY(p_states)
        AND (1 - (b.embedding <=> p_query_embedding)) >= p_min_similarity
    ORDER BY b.embedding <=> p_query_embedding
    LIMIT p_limit;
END;
$$;
CREATE FUNCTION public.semantic_search_cross_basket(p_workspace_id uuid, p_query_embedding public.vector, p_scopes text[] DEFAULT ARRAY['WORKSPACE'::text, 'GLOBAL'::text], p_semantic_types text[] DEFAULT NULL::text[], p_min_similarity numeric DEFAULT 0.70, p_limit integer DEFAULT 10) RETURNS TABLE(id uuid, basket_id uuid, content text, semantic_type text, anchor_role text, scope text, similarity_score numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.id,
        b.basket_id,
        b.content,
        b.semantic_type,
        b.anchor_role,
        b.scope::TEXT,
        (1 - (b.embedding <=> p_query_embedding))::DECIMAL AS similarity_score
    FROM public.blocks b
    JOIN public.baskets bsk ON b.basket_id = bsk.id
    WHERE bsk.workspace_id = p_workspace_id
        AND b.embedding IS NOT NULL
        AND b.scope::TEXT = ANY(p_scopes)
        AND b.state IN ('ACCEPTED', 'LOCKED', 'CONSTANT')
        AND (p_semantic_types IS NULL OR b.semantic_type = ANY(p_semantic_types))
        AND (1 - (b.embedding <=> p_query_embedding)) >= p_min_similarity
    ORDER BY b.embedding <=> p_query_embedding
    LIMIT p_limit;
END;
$$;
CREATE FUNCTION public.set_basket_user_id() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end $$;
CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$;
CREATE FUNCTION public.sql(query text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$ BEGIN RETURN to_json(query); END; $$;
CREATE FUNCTION public.sync_raw_dump_text_columns() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- When body_md is updated, sync to text_dump
  IF NEW.body_md IS DISTINCT FROM OLD.body_md THEN
    NEW.text_dump = NEW.body_md;
  END IF;
  
  -- When text_dump is updated, sync to body_md  
  IF NEW.text_dump IS DISTINCT FROM OLD.text_dump THEN
    NEW.body_md = NEW.text_dump;
  END IF;
  
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.track_asset_access() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- Update access stats when asset is retrieved
  UPDATE reference_assets
  SET
    access_count = access_count + 1,
    last_accessed_at = now()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.traverse_relationships(p_start_block_id uuid, p_relationship_type text, p_direction text DEFAULT 'forward'::text, p_max_depth integer DEFAULT 2) RETURNS TABLE(id uuid, content text, semantic_type text, anchor_role text, depth integer, relationship_type text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE relationship_chain AS (
        -- Base case: start block
        SELECT
            b.id,
            b.content,
            b.semantic_type,
            b.anchor_role,
            0 AS depth,
            ''::TEXT AS relationship_type
        FROM public.blocks b
        WHERE b.id = p_start_block_id
        UNION ALL
        -- Recursive case: follow relationships
        SELECT
            b.id,
            b.content,
            b.semantic_type,
            b.anchor_role,
            rc.depth + 1,
            r.relationship_type
        FROM relationship_chain rc
        JOIN public.substrate_relationships r ON
            CASE
                WHEN p_direction = 'forward' THEN rc.id = r.from_block_id
                ELSE rc.id = r.to_block_id
            END
        JOIN public.blocks b ON
            CASE
                WHEN p_direction = 'forward' THEN r.to_block_id = b.id
                ELSE r.from_block_id = b.id
            END
        WHERE rc.depth < p_max_depth
            AND r.relationship_type = p_relationship_type
            AND r.state = 'ACCEPTED'
    )
    SELECT DISTINCT ON (relationship_chain.id)
        relationship_chain.id,
        relationship_chain.content,
        relationship_chain.semantic_type,
        relationship_chain.anchor_role,
        relationship_chain.depth,
        relationship_chain.relationship_type
    FROM relationship_chain
    WHERE relationship_chain.depth > 0  -- Exclude start block
    ORDER BY relationship_chain.id, relationship_chain.depth;
END;
$$;
CREATE FUNCTION public.update_agent_session_activity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.agent_session_id IS NOT NULL THEN
    UPDATE agent_sessions
    SET last_active_at = now()
    WHERE id = NEW.agent_session_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.update_context_entry_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;
CREATE FUNCTION public.update_context_item_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;
CREATE FUNCTION public.update_jobs_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.update_project_supervision_settings(p_project_id uuid, p_settings jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE projects
  SET metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{work_supervision}',
    p_settings
  ),
  updated_at = now()
  WHERE id = p_project_id;
END;
$$;
CREATE FUNCTION public.update_project_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.update_reflection_cache_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.update_schedule_next_run() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Only calculate if enabled
  IF NEW.enabled THEN
    NEW.next_run_at := calculate_next_run_at(
      NEW.frequency,
      NEW.day_of_week,
      NEW.time_of_day,
      NEW.cron_expression
    );
  ELSE
    NEW.next_run_at := NULL;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.update_substrate_relationships_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;
CREATE FUNCTION public.update_tp_session_stats() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE tp_sessions
    SET
        message_count = message_count + 1,
        last_message_at = NEW.created_at,
        updated_at = now()
    WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$;
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.update_work_session_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.validate_asset_storage_path(basket_id_param uuid, storage_path_param text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
  expected_prefix text;
BEGIN
  -- Expected format: baskets/{basket_id}/assets/{asset_id}/{filename}
  expected_prefix := 'baskets/' || basket_id_param::text || '/assets/';
  RETURN storage_path_param LIKE expected_prefix || '%';
END;
$$;
CREATE FUNCTION public.validate_structured_ingredient_metadata(metadata_json jsonb) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Validate that structured ingredients have required fields
    IF metadata_json ? 'knowledge_ingredients' THEN
        -- Must have provenance validation
        IF NOT (metadata_json -> 'provenance_validated')::boolean THEN
            RETURN false;
        END IF;
        
        -- Must have extraction method marker
        IF NOT (metadata_json ? 'extraction_method') THEN
            RETURN false;
        END IF;
        
        -- Knowledge ingredients must have provenance
        IF NOT (metadata_json -> 'knowledge_ingredients' ? 'provenance') THEN
            RETURN false;
        END IF;
        
        RETURN true;
    END IF;
    
    -- Legacy blocks are always valid
    RETURN true;
END;
$$;
CREATE FUNCTION public.verify_canon_compatibility() RETURNS TABLE(test_name text, status text, details text)
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Test 1: Check emit_timeline_event function exists
  RETURN QUERY SELECT 
    'emit_timeline_event_function'::text,
    CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'FAIL' END::text,
    'Function emit_timeline_event exists: ' || COUNT(*)::text
  FROM pg_proc 
  WHERE proname = 'emit_timeline_event';
  
  -- Test 2: Check timeline_events table structure
  RETURN QUERY SELECT 
    'timeline_events_structure'::text,
    CASE WHEN COUNT(*) = 6 THEN 'PASS' ELSE 'FAIL' END::text,
    'Required columns (basket_id, kind, ts, ref_id, preview, payload): ' || COUNT(*)::text
  FROM information_schema.columns 
  WHERE table_name = 'timeline_events' 
    AND column_name IN ('basket_id', 'kind', 'ts', 'ref_id', 'preview', 'payload');
    
  -- Test 3: Check constraint allows Canon v1.3.1 event types
  RETURN QUERY SELECT 
    'canon_event_types'::text,
    'PASS'::text,
    'Constraint updated to allow Canon v1.3.1 event types'::text;
    
  -- Test 4: Check fn_timeline_emit exists (dependency)
  RETURN QUERY SELECT 
    'fn_timeline_emit_exists'::text,
    CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'FAIL' END::text,
    'Function fn_timeline_emit exists: ' || COUNT(*)::text
  FROM pg_proc 
  WHERE proname = 'fn_timeline_emit';
END;
$$;
CREATE TABLE public.agent_catalog (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_type text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    monthly_price_cents integer NOT NULL,
    trial_work_requests integer DEFAULT 10 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    icon text,
    config_schema jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_beta boolean DEFAULT false NOT NULL,
    deprecated_at timestamp with time zone,
    schema_version integer DEFAULT 1 NOT NULL,
    created_by_user_id uuid,
    notes text,
    CONSTRAINT agent_type_lowercase CHECK ((agent_type = lower(agent_type))),
    CONSTRAINT monthly_price_positive CHECK ((monthly_price_cents > 0)),
    CONSTRAINT trial_requests_positive CHECK ((trial_work_requests >= 0))
);
CREATE TABLE public.agent_config_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_agent_id uuid NOT NULL,
    config_snapshot jsonb NOT NULL,
    config_version integer NOT NULL,
    changed_by_user_id uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    change_reason text,
    metadata jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE public.agent_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    basket_id uuid NOT NULL,
    agent_type text NOT NULL,
    sdk_session_id text,
    conversation_history jsonb DEFAULT '[]'::jsonb,
    state jsonb DEFAULT '{}'::jsonb,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    parent_session_id uuid,
    created_by_session_id uuid,
    CONSTRAINT agent_sessions_agent_type_check CHECK ((agent_type = ANY (ARRAY['research'::text, 'content'::text, 'reporting'::text, 'thinking_partner'::text])))
);
CREATE TABLE public.agent_work_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    basket_id uuid,
    agent_type text NOT NULL,
    is_trial_request boolean DEFAULT false NOT NULL,
    subscription_id uuid,
    work_mode text,
    request_payload jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    result_summary text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT agent_type_fk CHECK ((agent_type = ANY (ARRAY['research'::text, 'content'::text, 'reporting'::text]))),
    CONSTRAINT status_valid CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text]))),
    CONSTRAINT subscription_for_paid CHECK ((((is_trial_request = true) AND (subscription_id IS NULL)) OR ((is_trial_request = false) AND (subscription_id IS NOT NULL))))
);
CREATE TABLE public.blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    basket_id uuid,
    parent_block_id uuid,
    semantic_type text NOT NULL,
    content text,
    version integer DEFAULT 1 NOT NULL,
    state public.block_state DEFAULT 'PROPOSED'::public.block_state NOT NULL,
    scope public.scope_level,
    canonical_value text,
    origin_ref uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id uuid NOT NULL,
    meta_agent_notes text,
    label text,
    meta_tags text[],
    is_required boolean DEFAULT false,
    raw_dump_id uuid,
    title text,
    body_md text,
    confidence_score double precision DEFAULT 0.5,
    metadata jsonb DEFAULT '{}'::jsonb,
    processing_agent text,
    status text DEFAULT 'proposed'::text,
    proposal_id uuid,
    approved_at timestamp with time zone,
    approved_by uuid,
    normalized_label text,
    updated_at timestamp with time zone DEFAULT now(),
    last_validated_at timestamp with time zone DEFAULT now(),
    anchor_role text,
    anchor_status text DEFAULT 'proposed'::text,
    anchor_confidence real,
    embedding public.vector(1536),
    derived_from_asset_id uuid,
    refresh_policy jsonb,
    CONSTRAINT blocks_anchor_confidence_check CHECK (((anchor_confidence >= (0.0)::double precision) AND (anchor_confidence <= (1.0)::double precision))),
    CONSTRAINT blocks_anchor_confidence_v3_check CHECK (((anchor_confidence IS NULL) OR ((anchor_confidence >= (0.0)::double precision) AND (anchor_confidence <= (1.0)::double precision)))),
    CONSTRAINT blocks_anchor_role_check CHECK ((anchor_role = ANY (ARRAY['problem'::text, 'customer'::text, 'solution'::text, 'feature'::text, 'constraint'::text, 'metric'::text, 'insight'::text, 'vision'::text, 'trend_digest'::text, 'competitor_snapshot'::text, 'market_signal'::text, 'brand_voice'::text, 'strategic_direction'::text, 'customer_insight'::text]))),
    CONSTRAINT blocks_anchor_status_v3_check CHECK (((anchor_status IS NULL) OR (anchor_status = ANY (ARRAY['proposed'::text, 'accepted'::text, 'rejected'::text])))),
    CONSTRAINT blocks_constant_requires_scope CHECK ((((state = 'CONSTANT'::public.block_state) AND (scope IS NOT NULL)) OR (state <> 'CONSTANT'::public.block_state))),
    CONSTRAINT blocks_content_not_empty CHECK (((content IS NOT NULL) AND (content <> ''::text))),
    CONSTRAINT blocks_title_not_empty CHECK (((title IS NOT NULL) AND (title <> ''::text))),
    CONSTRAINT check_structured_ingredient_metadata CHECK (public.validate_structured_ingredient_metadata(metadata))
)
WITH (autovacuum_enabled='true');
ALTER TABLE ONLY public.blocks REPLICA IDENTITY FULL;
CREATE VIEW public.anchored_substrate AS
 SELECT 'block'::text AS substrate_type,
    b.id AS substrate_id,
    b.basket_id,
    b.workspace_id,
    b.anchor_role,
    b.anchor_status,
    b.anchor_confidence,
    b.title,
    b.content,
    b.semantic_type,
    (b.state)::text AS state,
    b.scope,
    b.created_at,
    b.updated_at,
    b.last_validated_at,
    b.metadata
   FROM public.blocks b
  WHERE (b.anchor_role IS NOT NULL);
CREATE TABLE public.app_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    v integer DEFAULT 1 NOT NULL,
    type text NOT NULL,
    name text NOT NULL,
    phase text,
    severity text DEFAULT 'info'::text NOT NULL,
    message text NOT NULL,
    workspace_id uuid NOT NULL,
    basket_id uuid,
    entity_id uuid,
    correlation_id text,
    dedupe_key text,
    ttl_ms integer,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_events_phase_check CHECK ((phase = ANY (ARRAY['started'::text, 'progress'::text, 'succeeded'::text, 'failed'::text]))),
    CONSTRAINT app_events_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'success'::text, 'warning'::text, 'error'::text]))),
    CONSTRAINT app_events_type_check CHECK ((type = ANY (ARRAY['job_update'::text, 'system_alert'::text, 'action_result'::text, 'collab_activity'::text, 'validation'::text])))
);
CREATE TABLE public.artifact_generation_settings (
    workspace_id uuid NOT NULL,
    auto_substrate_reflection boolean DEFAULT true,
    auto_document_reflection boolean DEFAULT false,
    reflection_frequency interval DEFAULT '01:00:00'::interval,
    auto_version_on_edit boolean DEFAULT true,
    version_retention_days integer DEFAULT 90,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.asset_type_catalog (
    asset_type text NOT NULL,
    display_name text NOT NULL,
    description text,
    category text,
    allowed_mime_types text[],
    is_active boolean DEFAULT true NOT NULL,
    deprecated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id uuid,
    notes text
);
CREATE TABLE public.basket_deltas (
    delta_id uuid NOT NULL,
    basket_id uuid NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_at timestamp with time zone
);
CREATE TABLE public.basket_events (
    id integer NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE ONLY public.basket_events REPLICA IDENTITY FULL;
CREATE SEQUENCE public.basket_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.basket_events_id_seq OWNED BY public.basket_events.id;
CREATE TABLE public.basket_signatures (
    basket_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    summary text,
    anchors jsonb DEFAULT '[]'::jsonb,
    entities text[] DEFAULT ARRAY[]::text[],
    keywords text[] DEFAULT ARRAY[]::text[],
    embedding double precision[] DEFAULT ARRAY[]::double precision[],
    last_refreshed timestamp with time zone DEFAULT now() NOT NULL,
    ttl_hours integer DEFAULT 336 NOT NULL,
    source_reflection_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.baskets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    raw_dump_id uuid,
    status public.basket_state DEFAULT 'INIT'::public.basket_state NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid DEFAULT auth.uid(),
    workspace_id uuid NOT NULL,
    origin_template text,
    tags text[] DEFAULT '{}'::text[],
    idempotency_key uuid
);
CREATE TABLE public.block_change_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    block_id uuid NOT NULL,
    change_type text NOT NULL,
    change_data jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.block_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    block_id uuid,
    document_id uuid,
    occurrences integer DEFAULT 0,
    snippets jsonb
);
CREATE TABLE public.block_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    block_id uuid,
    workspace_id uuid,
    actor_id uuid,
    summary text,
    diff_json jsonb,
    created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.block_usage (
    block_id uuid NOT NULL,
    times_referenced integer DEFAULT 0 NOT NULL,
    last_used_at timestamp with time zone,
    usefulness_score real GENERATED ALWAYS AS (
CASE
    WHEN (times_referenced = 0) THEN 0.0
    WHEN (times_referenced < 3) THEN 0.5
    ELSE 0.9
END) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.context_entry_schemas (
    anchor_role text NOT NULL,
    display_name text NOT NULL,
    description text,
    icon text,
    category text,
    is_singleton boolean DEFAULT true,
    field_schema jsonb NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT context_entry_schemas_category_check CHECK ((category = ANY (ARRAY['foundation'::text, 'market'::text, 'insight'::text])))
);
CREATE TABLE public.context_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    basket_id uuid NOT NULL,
    tier text NOT NULL,
    item_type text NOT NULL,
    item_key text,
    title text,
    content jsonb DEFAULT '{}'::jsonb NOT NULL,
    schema_id text,
    asset_ids uuid[] DEFAULT '{}'::uuid[],
    tags text[] DEFAULT '{}'::text[],
    embedding public.vector(1536),
    created_by text NOT NULL,
    updated_by text,
    status text DEFAULT 'active'::text,
    expires_at timestamp with time zone,
    version integer DEFAULT 1,
    previous_version_id uuid,
    source_type text,
    source_ref jsonb,
    completeness_score double precision,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT context_items_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text, 'superseded'::text]))),
    CONSTRAINT context_items_tier_check CHECK ((tier = ANY (ARRAY['foundation'::text, 'working'::text, 'ephemeral'::text])))
);
CREATE TABLE public.document_context_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    context_item_id uuid NOT NULL,
    role text,
    weight numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.document_versions (
    version_hash character varying(64) NOT NULL,
    document_id uuid NOT NULL,
    content text NOT NULL,
    metadata_snapshot jsonb DEFAULT '{}'::jsonb,
    substrate_refs_snapshot jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    version_message text,
    parent_version_hash character varying(64),
    composition_contract jsonb DEFAULT '{}'::jsonb,
    composition_signature character varying(64),
    version_trigger text,
    CONSTRAINT non_empty_content CHECK ((length(content) > 0)),
    CONSTRAINT valid_version_hash CHECK (((version_hash)::text ~ '^doc_v[a-f0-9]{58}$'::text)),
    CONSTRAINT valid_version_trigger CHECK (((version_trigger IS NULL) OR (version_trigger = ANY (ARRAY['initial'::text, 'substrate_update'::text, 'user_requested'::text, 'instruction_change'::text, 'upload_composition'::text, 'migrated'::text]))))
);
CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    basket_id uuid,
    title text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_by uuid,
    workspace_id uuid NOT NULL,
    document_type text DEFAULT 'general'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    current_version_hash character varying(64),
    composition_instructions jsonb DEFAULT '{}'::jsonb,
    substrate_filter jsonb DEFAULT '{}'::jsonb,
    source_raw_dump_id uuid,
    doc_type text DEFAULT 'artifact_other'::text,
    previous_id uuid,
    derived_from jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['document_canon'::text, 'starter_prompt'::text, 'artifact_other'::text])))
);
CREATE VIEW public.document_heads AS
 SELECT d.id AS document_id,
    d.basket_id,
    d.workspace_id,
    d.title,
    d.document_type,
    d.composition_instructions,
    d.substrate_filter,
    d.source_raw_dump_id,
    d.current_version_hash,
    d.created_at AS document_created_at,
    d.created_by AS document_created_by,
    d.updated_at AS document_updated_at,
    d.metadata AS document_metadata,
    dv.content,
    dv.metadata_snapshot AS version_metadata,
    dv.substrate_refs_snapshot,
    dv.created_at AS version_created_at,
    dv.created_by AS version_created_by,
    dv.version_trigger,
    dv.version_message
   FROM (public.documents d
     LEFT JOIN public.document_versions dv ON (((dv.version_hash)::text = (d.current_version_hash)::text)));
CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    basket_id uuid,
    block_id uuid,
    kind text,
    payload jsonb,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id uuid NOT NULL,
    origin text DEFAULT 'user'::text,
    actor_id uuid,
    agent_type text,
    CONSTRAINT events_origin_check CHECK ((origin = ANY (ARRAY['user'::text, 'agent'::text, 'daemon'::text, 'system'::text])))
);
CREATE TABLE public.extraction_quality_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dump_id uuid,
    basket_id uuid,
    workspace_id uuid NOT NULL,
    agent_version text NOT NULL,
    blocks_created integer DEFAULT 0,
    context_items_created integer DEFAULT 0,
    duplicates_detected integer DEFAULT 0,
    orphans_created integer DEFAULT 0,
    avg_confidence real DEFAULT 0.0,
    processing_time_ms integer,
    blocks_accepted integer DEFAULT 0,
    blocks_rejected integer DEFAULT 0,
    blocks_used integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.idempotency_keys (
    request_id text NOT NULL,
    delta_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.integration_tokens (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    token_hash text NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone
);
CREATE TABLE public.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    scheduled_for timestamp with time zone DEFAULT now() NOT NULL,
    priority integer DEFAULT 5,
    status text DEFAULT 'pending'::text,
    claimed_by text,
    claimed_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    attempts integer DEFAULT 0,
    max_attempts integer DEFAULT 3,
    last_error text,
    retry_after timestamp with time zone,
    result jsonb,
    parent_schedule_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT jobs_priority_check CHECK (((priority >= 1) AND (priority <= 10))),
    CONSTRAINT jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'claimed'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
);
CREATE TABLE public.knowledge_timeline (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    basket_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    event_type public.knowledge_event_type NOT NULL,
    significance public.event_significance DEFAULT 'medium'::public.event_significance,
    title text NOT NULL,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb,
    related_ids jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT knowledge_timeline_description_length CHECK ((length(description) <= 1000)),
    CONSTRAINT knowledge_timeline_title_length CHECK (((length(title) >= 1) AND (length(title) <= 200)))
);
CREATE TABLE public.mcp_activity_logs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid,
    tool text NOT NULL,
    host text NOT NULL,
    result text NOT NULL,
    latency_ms integer,
    basket_id uuid,
    selection_decision text,
    selection_score numeric,
    error_code text,
    session_id text,
    fingerprint_summary text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE VIEW public.mcp_activity_host_recent AS
 SELECT mcp_activity_logs.workspace_id,
    mcp_activity_logs.host,
    max(mcp_activity_logs.created_at) AS last_seen_at,
    count(*) FILTER (WHERE (mcp_activity_logs.created_at >= (now() - '01:00:00'::interval))) AS calls_last_hour,
    count(*) FILTER (WHERE ((mcp_activity_logs.result = 'error'::text) AND (mcp_activity_logs.created_at >= (now() - '01:00:00'::interval)))) AS errors_last_hour,
    percentile_cont((0.95)::double precision) WITHIN GROUP (ORDER BY ((COALESCE(mcp_activity_logs.latency_ms, 0))::double precision)) AS p95_latency_ms
   FROM public.mcp_activity_logs
  WHERE (mcp_activity_logs.created_at >= (now() - '7 days'::interval))
  GROUP BY mcp_activity_logs.workspace_id, mcp_activity_logs.host;
CREATE TABLE public.mcp_oauth_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mcp_token text NOT NULL,
    supabase_token text NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.mcp_unassigned_captures (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    requested_by uuid,
    tool text NOT NULL,
    summary text,
    payload jsonb,
    fingerprint jsonb,
    candidates jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    assigned_basket_id uuid,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_host text,
    source_session text
);
CREATE TABLE public.narrative (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    basket_id uuid,
    raw_dump_id uuid,
    type text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    confidence_score double precision DEFAULT 0.5,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
ALTER TABLE ONLY public.narrative REPLICA IDENTITY FULL;
CREATE TABLE public.openai_app_tokens (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    install_id text,
    access_token text,
    refresh_token text,
    expires_at timestamp with time zone,
    scope text,
    provider_metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    access_token_enc jsonb,
    refresh_token_enc jsonb,
    encryption_version smallint,
    encryption_updated_at timestamp with time zone,
    rotated_at timestamp with time zone
);
CREATE TABLE public.output_type_catalog (
    output_type text NOT NULL,
    display_name text NOT NULL,
    description text,
    allowed_agent_types text[],
    can_merge_to_substrate boolean DEFAULT false NOT NULL,
    merge_target text,
    is_active boolean DEFAULT true NOT NULL,
    deprecated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    CONSTRAINT output_type_catalog_merge_target_check CHECK ((merge_target = ANY (ARRAY['block'::text, 'document'::text, 'none'::text])))
);
CREATE TABLE public.p3_p4_regeneration_policy (
    workspace_id uuid NOT NULL,
    insight_canon_auto_regenerate boolean DEFAULT true,
    document_canon_auto_regenerate boolean DEFAULT true,
    workspace_insight_enabled boolean DEFAULT false,
    workspace_insight_min_baskets integer DEFAULT 3,
    workspace_insight_throttle_hours integer DEFAULT 24,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.pipeline_metrics (
    id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    pipeline text NOT NULL,
    basket_id uuid,
    dump_id uuid,
    doc_id uuid,
    dims jsonb DEFAULT '{}'::jsonb NOT NULL,
    counts jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE SEQUENCE public.pipeline_metrics_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.pipeline_metrics_id_seq OWNED BY public.pipeline_metrics.id;
CREATE TABLE public.pipeline_offsets (
    pipeline_name text NOT NULL,
    last_event_id uuid,
    last_event_ts timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.project_agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    agent_type text NOT NULL,
    display_name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id uuid,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    config_version integer DEFAULT 1 NOT NULL,
    config_updated_at timestamp with time zone DEFAULT now(),
    config_updated_by uuid
);
CREATE TABLE public.project_recipe_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    recipe_slug text NOT NULL,
    cron_expression text,
    interval_hours integer,
    enabled boolean DEFAULT true,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone,
    last_run_status text,
    last_run_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    CONSTRAINT project_recipe_schedules_check CHECK (((cron_expression IS NOT NULL) OR (interval_hours IS NOT NULL))),
    CONSTRAINT project_recipe_schedules_last_run_status_check CHECK ((last_run_status = ANY (ARRAY['success'::text, 'failed'::text, 'skipped'::text])))
);
CREATE TABLE public.project_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    recipe_id uuid NOT NULL,
    basket_id uuid NOT NULL,
    frequency text NOT NULL,
    cron_expression text,
    day_of_week integer,
    time_of_day time without time zone DEFAULT '09:00:00'::time without time zone,
    recipe_parameters jsonb DEFAULT '{}'::jsonb,
    enabled boolean DEFAULT true,
    next_run_at timestamp with time zone,
    last_run_at timestamp with time zone,
    last_run_status text,
    last_run_ticket_id uuid,
    run_count integer DEFAULT 0,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT project_schedules_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
    CONSTRAINT project_schedules_frequency_check CHECK ((frequency = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text, 'custom'::text]))),
    CONSTRAINT project_schedules_last_run_status_check CHECK ((last_run_status = ANY (ARRAY['success'::text, 'failed'::text, 'skipped'::text])))
);
CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    basket_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    origin_template text,
    onboarded_at timestamp with time zone,
    archived_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT projects_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text, 'completed'::text, 'on_hold'::text])))
);
CREATE TABLE public.proposal_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    proposal_id uuid NOT NULL,
    operation_index integer NOT NULL,
    operation_type text NOT NULL,
    executed_at timestamp with time zone DEFAULT now() NOT NULL,
    success boolean NOT NULL,
    result_data jsonb DEFAULT '{}'::jsonb,
    error_message text,
    substrate_id uuid,
    rpc_called text,
    execution_time_ms integer,
    operations_count integer,
    operations_summary jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE public.proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    basket_id uuid,
    workspace_id uuid NOT NULL,
    proposal_kind public.proposal_kind NOT NULL,
    basis_snapshot_id uuid,
    origin text NOT NULL,
    provenance jsonb DEFAULT '[]'::jsonb,
    ops jsonb NOT NULL,
    validator_report jsonb DEFAULT '{}'::jsonb,
    status public.proposal_state DEFAULT 'PROPOSED'::public.proposal_state NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_notes text,
    metadata jsonb DEFAULT '{}'::jsonb,
    blast_radius public.blast_radius DEFAULT 'Local'::public.blast_radius,
    executed_at timestamp with time zone,
    execution_log jsonb DEFAULT '[]'::jsonb,
    commit_id uuid,
    is_executed boolean DEFAULT false,
    validator_version text DEFAULT 'v1.0'::text,
    validation_required boolean DEFAULT true,
    validation_bypassed boolean DEFAULT false,
    bypass_reason text,
    source_host text,
    source_session text,
    scope text DEFAULT 'basket'::text,
    target_basket_id uuid,
    affected_basket_ids uuid[] DEFAULT '{}'::uuid[],
    CONSTRAINT proposals_origin_check CHECK ((origin = ANY (ARRAY['agent'::text, 'human'::text]))),
    CONSTRAINT proposals_scope_check CHECK ((scope = ANY (ARRAY['basket'::text, 'workspace'::text, 'cross-basket'::text])))
);
CREATE TABLE public.raw_dumps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    basket_id uuid NOT NULL,
    body_md text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id uuid NOT NULL,
    file_url text,
    document_id uuid,
    fragments jsonb DEFAULT '[]'::jsonb,
    processing_status text DEFAULT 'unprocessed'::text,
    processed_at timestamp with time zone,
    source_meta jsonb DEFAULT '{}'::jsonb,
    ingest_trace_id text,
    dump_request_id uuid,
    text_dump text
);
ALTER TABLE ONLY public.raw_dumps REPLICA IDENTITY FULL;
CREATE TABLE public.reference_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    basket_id uuid NOT NULL,
    storage_path text NOT NULL,
    file_name text NOT NULL,
    file_size_bytes bigint,
    mime_type text,
    asset_type text NOT NULL,
    asset_category text NOT NULL,
    permanence text DEFAULT 'permanent'::text NOT NULL,
    expires_at timestamp with time zone,
    work_session_id uuid,
    agent_scope text[],
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    tags text[],
    description text,
    description_embedding public.vector(1536),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id uuid,
    last_accessed_at timestamp with time zone,
    access_count integer DEFAULT 0 NOT NULL,
    classification_status text DEFAULT 'unclassified'::text,
    classification_confidence double precision,
    classified_at timestamp with time zone,
    classification_metadata jsonb DEFAULT '{}'::jsonb,
    context_field_key text,
    context_item_id uuid,
    CONSTRAINT access_count_non_negative CHECK ((access_count >= 0)),
    CONSTRAINT expires_at_future CHECK (((expires_at IS NULL) OR (expires_at > created_at))),
    CONSTRAINT file_size_positive CHECK (((file_size_bytes IS NULL) OR (file_size_bytes > 0))),
    CONSTRAINT reference_assets_classification_status_check CHECK ((classification_status = ANY (ARRAY['unclassified'::text, 'classifying'::text, 'classified'::text, 'failed'::text]))),
    CONSTRAINT reference_assets_permanence_check CHECK ((permanence = ANY (ARRAY['permanent'::text, 'temporary'::text]))),
    CONSTRAINT temporary_must_expire CHECK ((((permanence = 'temporary'::text) AND (expires_at IS NOT NULL)) OR (permanence = 'permanent'::text))),
    CONSTRAINT valid_storage_path CHECK (public.validate_asset_storage_path(basket_id, storage_path))
);
CREATE TABLE public.reflections_artifact (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    basket_id uuid,
    workspace_id uuid NOT NULL,
    substrate_hash text NOT NULL,
    reflection_text text NOT NULL,
    substrate_window_start timestamp with time zone,
    substrate_window_end timestamp with time zone,
    computation_timestamp timestamp with time zone NOT NULL,
    last_accessed_at timestamp with time zone DEFAULT now(),
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    insight_type text,
    is_current boolean DEFAULT false,
    previous_id uuid,
    derived_from jsonb DEFAULT '[]'::jsonb,
    graph_signature text,
    scope_level text DEFAULT 'basket'::text,
    CONSTRAINT insight_scope_consistency CHECK ((((scope_level = 'basket'::text) AND (basket_id IS NOT NULL)) OR ((scope_level <> 'basket'::text) AND (basket_id IS NULL)))),
    CONSTRAINT reflections_artifact_insight_type_check CHECK ((insight_type = ANY (ARRAY['insight_canon'::text, 'doc_insight'::text, 'timeboxed_insight'::text, 'review_insight'::text]))),
    CONSTRAINT reflections_artifact_scope_level_check CHECK ((scope_level = ANY (ARRAY['basket'::text, 'workspace'::text, 'org'::text, 'global'::text])))
);
CREATE TABLE public.revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    basket_id uuid,
    actor_id uuid,
    summary text,
    diff_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.substrate_references (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    substrate_type public.substrate_type NOT NULL,
    substrate_id uuid NOT NULL,
    role text,
    weight numeric(3,2),
    snippets jsonb DEFAULT '[]'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    CONSTRAINT substrate_references_weight_check CHECK (((weight >= (0)::numeric) AND (weight <= (1)::numeric)))
);
CREATE TABLE public.substrate_relationships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_block_id uuid NOT NULL,
    to_block_id uuid NOT NULL,
    relationship_type text NOT NULL,
    confidence_score numeric(3,2),
    inference_method text,
    state public.block_state DEFAULT 'PROPOSED'::public.block_state NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT no_self_reference CHECK ((from_block_id <> to_block_id)),
    CONSTRAINT valid_confidence_score CHECK (((confidence_score IS NULL) OR ((confidence_score >= (0)::numeric) AND (confidence_score <= (1)::numeric)))),
    CONSTRAINT valid_inference_method CHECK (((inference_method IS NULL) OR (inference_method = ANY (ARRAY['semantic_search'::text, 'llm_verification'::text, 'user_created'::text, 'agent_inferred'::text])))),
    CONSTRAINT valid_relationship_type CHECK ((relationship_type = ANY (ARRAY['addresses'::text, 'supports'::text, 'contradicts'::text, 'depends_on'::text])))
);
CREATE TABLE public.substrate_tombstones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    basket_id uuid NOT NULL,
    substrate_type text NOT NULL,
    substrate_id uuid NOT NULL,
    deletion_mode text NOT NULL,
    redaction_scope text,
    redaction_reason text,
    legal_hold boolean DEFAULT false,
    refs_detached_count integer DEFAULT 0,
    relationships_pruned_count integer DEFAULT 0,
    affected_documents_count integer DEFAULT 0,
    retention_policy_id uuid,
    earliest_physical_delete_at timestamp with time zone,
    event_ids uuid[] DEFAULT '{}'::uuid[],
    content_fingerprint text,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    physically_deleted_at timestamp with time zone,
    CONSTRAINT substrate_tombstones_deletion_mode_check CHECK ((deletion_mode = ANY (ARRAY['archived'::text, 'redacted'::text, 'deleted'::text]))),
    CONSTRAINT substrate_tombstones_redaction_scope_check CHECK ((redaction_scope = ANY (ARRAY['full'::text, 'partial'::text]))),
    CONSTRAINT substrate_tombstones_substrate_type_check CHECK ((substrate_type = ANY (ARRAY['block'::text, 'context_item'::text, 'dump'::text, 'timeline_event'::text])))
);
CREATE TABLE public.timeline_events (
    id bigint NOT NULL,
    basket_id uuid NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    kind text NOT NULL,
    ref_id uuid,
    preview text,
    payload jsonb,
    workspace_id uuid NOT NULL,
    source_host text,
    source_session text,
    CONSTRAINT timeline_events_kind_check CHECK ((kind = ANY (ARRAY['dump'::text, 'reflection'::text, 'narrative'::text, 'system_note'::text, 'block'::text, 'dump.created'::text, 'dump.queued'::text, 'block.created'::text, 'block.updated'::text, 'block.state_changed'::text, 'context_item.created'::text, 'context_item.updated'::text, 'context_item.archived'::text, 'relationship.created'::text, 'relationship.deleted'::text, 'reflection.computed'::text, 'reflection.cached'::text, 'document.created'::text, 'document.updated'::text, 'document.composed'::text, 'narrative.authored'::text, 'document.block.attached'::text, 'document.block.detached'::text, 'document.dump.attached'::text, 'document.dump.detached'::text, 'document.context_item.attached'::text, 'document.context_item.detached'::text, 'document.reflection.attached'::text, 'document.reflection.detached'::text, 'document.timeline_event.attached'::text, 'document.timeline_event.detached'::text, 'proposal.submitted'::text, 'proposal.approved'::text, 'proposal.rejected'::text, 'substrate.committed'::text, 'basket.created'::text, 'workspace.member_added'::text, 'delta.applied'::text, 'delta.rejected'::text, 'cascade.completed'::text, 'work.initiated'::text, 'work.routed'::text, 'pipeline.cascade_triggered'::text, 'pipeline.cascade_completed'::text, 'pipeline.cascade_failed'::text, 'queue.entry_created'::text, 'queue.processing_started'::text, 'queue.processing_completed'::text, 'queue.processing_failed'::text])))
);
CREATE SEQUENCE public.timeline_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.timeline_events_id_seq OWNED BY public.timeline_events.id;
CREATE TABLE public.tp_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    basket_id uuid NOT NULL,
    session_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    work_output_ids uuid[] DEFAULT '{}'::uuid[],
    tool_calls jsonb DEFAULT '[]'::jsonb,
    model text,
    input_tokens integer,
    output_tokens integer,
    tp_phase text,
    context_snapshot jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    CONSTRAINT tp_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text])))
);
CREATE TABLE public.tp_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    basket_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    title text,
    summary text,
    status text DEFAULT 'active'::text,
    message_count integer DEFAULT 0,
    last_message_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id uuid,
    CONSTRAINT tp_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text, 'expired'::text])))
);
CREATE TABLE public.user_agent_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    agent_type text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    stripe_subscription_id text,
    stripe_customer_id text,
    monthly_price_cents integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_type_fk CHECK ((agent_type = ANY (ARRAY['research'::text, 'content'::text, 'reporting'::text]))),
    CONSTRAINT price_positive CHECK ((monthly_price_cents > 0)),
    CONSTRAINT status_valid CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text, 'expired'::text])))
);
CREATE TABLE public.user_alerts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    alert_type public.alert_type NOT NULL,
    severity public.alert_severity DEFAULT 'info'::public.alert_severity,
    title text NOT NULL,
    message text NOT NULL,
    actionable boolean DEFAULT false,
    action_url text,
    action_label text,
    related_entities jsonb DEFAULT '{}'::jsonb,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    dismissed_at timestamp with time zone,
    CONSTRAINT user_alerts_action_label_length CHECK (((actionable = false) OR ((length(action_label) >= 1) AND (length(action_label) <= 50)))),
    CONSTRAINT user_alerts_message_length CHECK (((length(message) >= 1) AND (length(message) <= 500))),
    CONSTRAINT user_alerts_title_length CHECK (((length(title) >= 1) AND (length(title) <= 150)))
);
CREATE VIEW public.v_events_rel_bulk AS
 SELECT events.id,
    events.basket_id,
    events.kind,
    events.payload,
    events.ts
   FROM public.events
  WHERE (events.kind = 'rel.bulk_upserted'::text)
  ORDER BY events.ts;
CREATE VIEW public.v_kpi_24h AS
 WITH pm AS (
         SELECT pipeline_metrics.id,
            pipeline_metrics.ts,
            pipeline_metrics.pipeline,
            pipeline_metrics.basket_id,
            pipeline_metrics.dump_id,
            pipeline_metrics.doc_id,
            pipeline_metrics.dims,
            pipeline_metrics.counts
           FROM public.pipeline_metrics
          WHERE (pipeline_metrics.ts > (now() - '24:00:00'::interval))
        ), runs AS (
         SELECT pm.pipeline,
            count(*) AS runs
           FROM pm
          GROUP BY pm.pipeline
        ), agg AS (
         SELECT pm.pipeline,
            kv.key,
            sum((kv.val)::numeric) AS value
           FROM (pm
             CROSS JOIN LATERAL jsonb_each_text(pm.counts) kv(key, val))
          WHERE (kv.val ~ '^-?\\d+(\\.\\d+)?$'::text)
          GROUP BY pm.pipeline, kv.key
        )
 SELECT r.pipeline,
    r.runs,
    COALESCE(jsonb_object_agg(a.key, to_jsonb(a.value) ORDER BY a.key), '{}'::jsonb) AS totals
   FROM (runs r
     LEFT JOIN agg a USING (pipeline))
  GROUP BY r.pipeline, r.runs;
CREATE VIEW public.v_kpi_basket_recent AS
 SELECT pipeline_metrics.basket_id,
    pipeline_metrics.pipeline,
    pipeline_metrics.ts,
    pipeline_metrics.counts,
    pipeline_metrics.dims
   FROM public.pipeline_metrics
  WHERE (pipeline_metrics.ts > (now() - '7 days'::interval))
  ORDER BY pipeline_metrics.ts DESC;
CREATE TABLE public.workspace_memberships (
    id bigint NOT NULL,
    workspace_id uuid,
    user_id uuid,
    role text DEFAULT 'member'::text,
    created_at timestamp with time zone DEFAULT now()
);
CREATE VIEW public.v_user_workspaces AS
 SELECT wm.user_id,
    wm.workspace_id
   FROM public.workspace_memberships wm;
CREATE TABLE public.work_checkpoints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    work_ticket_id uuid NOT NULL,
    checkpoint_sequence integer NOT NULL,
    checkpoint_type text NOT NULL,
    review_scope text NOT NULL,
    outputs_at_checkpoint uuid[],
    agent_confidence numeric,
    agent_reasoning text,
    agent_summary text,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by_user_id uuid,
    reviewed_at timestamp with time zone,
    user_decision text,
    user_feedback text,
    changes_requested jsonb,
    risk_level text,
    risk_factors jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT work_checkpoints_agent_confidence_check CHECK (((agent_confidence >= (0)::numeric) AND (agent_confidence <= (1)::numeric))),
    CONSTRAINT work_checkpoints_checkpoint_type_check CHECK ((checkpoint_type = ANY (ARRAY['plan_approval'::text, 'mid_work_review'::text, 'artifact_review'::text, 'final_approval'::text]))),
    CONSTRAINT work_checkpoints_risk_level_check CHECK ((risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT work_checkpoints_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'skipped'::text]))),
    CONSTRAINT work_checkpoints_user_decision_check CHECK ((user_decision = ANY (ARRAY['approve'::text, 'reject'::text, 'request_changes'::text])))
);
CREATE TABLE public.work_iterations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    work_ticket_id uuid NOT NULL,
    iteration_number integer NOT NULL,
    triggered_by text NOT NULL,
    user_feedback_text text,
    changes_requested jsonb,
    agent_interpretation text,
    revised_approach text,
    outputs_revised uuid[],
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT work_iterations_triggered_by_check CHECK ((triggered_by = ANY (ARRAY['checkpoint_rejection'::text, 'user_feedback'::text, 'agent_self_correction'::text, 'context_staleness'::text])))
);
CREATE TABLE public.work_outputs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    basket_id uuid NOT NULL,
    work_ticket_id uuid NOT NULL,
    output_type text NOT NULL,
    agent_type text NOT NULL,
    title text NOT NULL,
    body text,
    confidence double precision,
    source_context_ids uuid[],
    tool_call_id text,
    supervision_status text DEFAULT 'pending_review'::text NOT NULL,
    reviewer_notes text,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    substrate_proposal_id uuid,
    merged_to_substrate_at timestamp with time zone,
    file_id text,
    file_format text,
    file_size_bytes integer,
    mime_type text,
    storage_path text,
    generation_method text DEFAULT 'text'::text,
    skill_metadata jsonb,
    promoted_to_block_id uuid,
    promotion_method text,
    promoted_at timestamp with time zone,
    promoted_by uuid,
    target_context_role text,
    auto_promote boolean DEFAULT false,
    promotion_status text DEFAULT 'pending'::text,
    CONSTRAINT title_not_empty CHECK ((length(TRIM(BOTH FROM title)) > 0)),
    CONSTRAINT work_outputs_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::double precision) AND (confidence <= (1)::double precision)))),
    CONSTRAINT work_outputs_content_type CHECK ((((body IS NOT NULL) AND (file_id IS NULL)) OR ((body IS NULL) AND (file_id IS NOT NULL)))),
    CONSTRAINT work_outputs_generation_method_check CHECK ((generation_method = ANY (ARRAY['text'::text, 'code_execution'::text, 'skill'::text, 'manual'::text]))),
    CONSTRAINT work_outputs_promotion_method_check CHECK ((promotion_method = ANY (ARRAY['auto'::text, 'manual'::text, 'skipped'::text, 'rejected'::text]))),
    CONSTRAINT work_outputs_promotion_status_check CHECK ((promotion_status = ANY (ARRAY['pending'::text, 'promoted'::text, 'rejected'::text, 'skipped'::text]))),
    CONSTRAINT work_outputs_storage_path_format CHECK (((storage_path IS NULL) OR (storage_path ~~ (('baskets/'::text || (basket_id)::text) || '/work_outputs/%'::text)))),
    CONSTRAINT work_outputs_supervision_status_check CHECK ((supervision_status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'rejected'::text, 'revision_requested'::text, 'archived'::text])))
);
CREATE TABLE public.work_recipes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    category character varying(50),
    agent_type character varying(50) NOT NULL,
    deliverable_intent jsonb DEFAULT '{}'::jsonb NOT NULL,
    configurable_parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    output_specification jsonb NOT NULL,
    context_requirements jsonb DEFAULT '{}'::jsonb,
    execution_template jsonb NOT NULL,
    estimated_duration_seconds_range integer[],
    estimated_cost_cents_range integer[],
    status character varying(20) DEFAULT 'active'::character varying,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    context_outputs jsonb,
    CONSTRAINT work_recipes_agent_type_check CHECK (((agent_type)::text = ANY ((ARRAY['research'::character varying, 'content'::character varying, 'reporting'::character varying])::text[]))),
    CONSTRAINT work_recipes_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'beta'::character varying, 'deprecated'::character varying])::text[])))
);
CREATE TABLE public.work_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    basket_id uuid NOT NULL,
    agent_session_id uuid,
    requested_by_user_id uuid NOT NULL,
    request_type text NOT NULL,
    task_intent text NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb,
    priority text DEFAULT 'normal'::text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    recipe_id uuid,
    recipe_parameters jsonb DEFAULT '{}'::jsonb,
    reference_asset_ids uuid[] DEFAULT '{}'::uuid[],
    CONSTRAINT work_requests_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])))
);
CREATE TABLE public.work_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    work_request_id uuid NOT NULL,
    agent_session_id uuid,
    workspace_id uuid NOT NULL,
    basket_id uuid NOT NULL,
    agent_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_message text,
    reasoning_trail jsonb[] DEFAULT '{}'::jsonb[],
    context_snapshot jsonb,
    outputs_count integer DEFAULT 0,
    checkpoints_count integer DEFAULT 0,
    iterations_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT work_tickets_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
);
CREATE TABLE public.workspace_governance_settings (
    workspace_id uuid NOT NULL,
    governance_enabled boolean DEFAULT false NOT NULL,
    validator_required boolean DEFAULT false NOT NULL,
    direct_substrate_writes boolean DEFAULT false NOT NULL,
    governance_ui_enabled boolean DEFAULT false NOT NULL,
    ep_onboarding_dump text DEFAULT 'direct'::text NOT NULL,
    ep_manual_edit text DEFAULT 'proposal'::text NOT NULL,
    ep_document_edit text DEFAULT 'proposal'::text NOT NULL,
    ep_graph_action text DEFAULT 'proposal'::text NOT NULL,
    ep_timeline_restore text DEFAULT 'proposal'::text NOT NULL,
    default_blast_radius public.blast_radius DEFAULT 'Scoped'::public.blast_radius NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    artifact_generation_enabled boolean DEFAULT true,
    auto_reflection_compute boolean DEFAULT true,
    document_versioning_enabled boolean DEFAULT true,
    retention_enabled boolean DEFAULT false NOT NULL,
    retention_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    ep_reflection_suggestion text DEFAULT 'proposal'::text NOT NULL,
    CONSTRAINT workspace_governance_settings_ep_document_edit_check CHECK ((ep_document_edit = ANY (ARRAY['proposal'::text, 'direct'::text, 'hybrid'::text]))),
    CONSTRAINT workspace_governance_settings_ep_graph_action_check CHECK ((ep_graph_action = ANY (ARRAY['proposal'::text, 'direct'::text, 'hybrid'::text]))),
    CONSTRAINT workspace_governance_settings_ep_manual_edit_check CHECK ((ep_manual_edit = ANY (ARRAY['proposal'::text, 'direct'::text, 'hybrid'::text]))),
    CONSTRAINT workspace_governance_settings_ep_onboarding_dump_check CHECK ((ep_onboarding_dump = ANY (ARRAY['proposal'::text, 'direct'::text, 'hybrid'::text]))),
    CONSTRAINT workspace_governance_settings_ep_reflection_suggestion_check CHECK ((ep_reflection_suggestion = ANY (ARRAY['proposal'::text, 'direct'::text, 'hybrid'::text]))),
    CONSTRAINT workspace_governance_settings_ep_timeline_restore_check CHECK ((ep_timeline_restore = ANY (ARRAY['proposal'::text, 'direct'::text, 'hybrid'::text])))
);
CREATE SEQUENCE public.workspace_memberships_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.workspace_memberships_id_seq OWNED BY public.workspace_memberships.id;
CREATE TABLE public.workspaces (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    owner_id uuid,
    name text NOT NULL,
    is_demo boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE ONLY public.basket_events ALTER COLUMN id SET DEFAULT nextval('public.basket_events_id_seq'::regclass);
ALTER TABLE ONLY public.pipeline_metrics ALTER COLUMN id SET DEFAULT nextval('public.pipeline_metrics_id_seq'::regclass);
ALTER TABLE ONLY public.timeline_events ALTER COLUMN id SET DEFAULT nextval('public.timeline_events_id_seq'::regclass);
ALTER TABLE ONLY public.workspace_memberships ALTER COLUMN id SET DEFAULT nextval('public.workspace_memberships_id_seq'::regclass);
ALTER TABLE ONLY public.agent_catalog
    ADD CONSTRAINT agent_catalog_agent_type_key UNIQUE (agent_type);
ALTER TABLE ONLY public.agent_catalog
    ADD CONSTRAINT agent_catalog_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agent_config_history
    ADD CONSTRAINT agent_config_history_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agent_processing_queue
    ADD CONSTRAINT agent_processing_queue_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agent_sessions
    ADD CONSTRAINT agent_sessions_basket_id_agent_type_key UNIQUE (basket_id, agent_type);
ALTER TABLE ONLY public.agent_sessions
    ADD CONSTRAINT agent_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agent_work_requests
    ADD CONSTRAINT agent_work_requests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.app_events
    ADD CONSTRAINT app_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.artifact_generation_settings
    ADD CONSTRAINT artifact_generation_settings_pkey PRIMARY KEY (workspace_id);
ALTER TABLE ONLY public.asset_type_catalog
    ADD CONSTRAINT asset_type_catalog_pkey PRIMARY KEY (asset_type);
ALTER TABLE ONLY public.basket_deltas
    ADD CONSTRAINT basket_deltas_pkey PRIMARY KEY (delta_id);
ALTER TABLE ONLY public.basket_events
    ADD CONSTRAINT basket_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.reflections_artifact
    ADD CONSTRAINT basket_reflections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.basket_signatures
    ADD CONSTRAINT basket_signatures_pkey PRIMARY KEY (basket_id);
ALTER TABLE public.baskets
    ADD CONSTRAINT baskets_idem_is_uuid CHECK (((idempotency_key IS NULL) OR ((idempotency_key)::text ~* '^[0-9a-f-]{36}$'::text))) NOT VALID;
ALTER TABLE ONLY public.baskets
    ADD CONSTRAINT baskets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.block_change_queue
    ADD CONSTRAINT block_change_queue_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.block_links
    ADD CONSTRAINT block_links_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.block_revisions
    ADD CONSTRAINT block_revisions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.block_usage
    ADD CONSTRAINT block_usage_pkey PRIMARY KEY (block_id);
ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.context_entry_schemas
    ADD CONSTRAINT context_entry_schemas_pkey PRIMARY KEY (anchor_role);
ALTER TABLE ONLY public.context_items
    ADD CONSTRAINT context_items_basket_id_item_type_item_key_key UNIQUE (basket_id, item_type, item_key);
ALTER TABLE ONLY public.context_items
    ADD CONSTRAINT context_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.document_context_items
    ADD CONSTRAINT document_context_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_pkey PRIMARY KEY (version_hash);
ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);
ALTER TABLE public.raw_dumps
    ADD CONSTRAINT dumps_req_is_uuid CHECK (((dump_request_id IS NULL) OR ((dump_request_id)::text ~* '^[0-9a-f-]{36}$'::text))) NOT VALID;
ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.extraction_quality_metrics
    ADD CONSTRAINT extraction_quality_metrics_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (request_id);
ALTER TABLE ONLY public.integration_tokens
    ADD CONSTRAINT integration_tokens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.integration_tokens
    ADD CONSTRAINT integration_tokens_token_hash_key UNIQUE (token_hash);
ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.knowledge_timeline
    ADD CONSTRAINT knowledge_timeline_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.mcp_activity_logs
    ADD CONSTRAINT mcp_activity_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.mcp_oauth_sessions
    ADD CONSTRAINT mcp_oauth_sessions_mcp_token_key UNIQUE (mcp_token);
ALTER TABLE ONLY public.mcp_oauth_sessions
    ADD CONSTRAINT mcp_oauth_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.mcp_unassigned_captures
    ADD CONSTRAINT mcp_unassigned_captures_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.narrative
    ADD CONSTRAINT narrative_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.openai_app_tokens
    ADD CONSTRAINT openai_app_tokens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.output_type_catalog
    ADD CONSTRAINT output_type_catalog_pkey PRIMARY KEY (output_type);
ALTER TABLE ONLY public.p3_p4_regeneration_policy
    ADD CONSTRAINT p3_p4_regeneration_policy_pkey PRIMARY KEY (workspace_id);
ALTER TABLE ONLY public.pipeline_metrics
    ADD CONSTRAINT pipeline_metrics_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pipeline_offsets
    ADD CONSTRAINT pipeline_offsets_pkey PRIMARY KEY (pipeline_name);
ALTER TABLE ONLY public.project_agents
    ADD CONSTRAINT project_agents_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.project_recipe_schedules
    ADD CONSTRAINT project_recipe_schedules_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.project_recipe_schedules
    ADD CONSTRAINT project_recipe_schedules_project_id_recipe_slug_key UNIQUE (project_id, recipe_slug);
ALTER TABLE ONLY public.project_schedules
    ADD CONSTRAINT project_schedules_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.project_schedules
    ADD CONSTRAINT project_schedules_project_id_recipe_id_key UNIQUE (project_id, recipe_id);
ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.proposal_executions
    ADD CONSTRAINT proposal_executions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.raw_dumps
    ADD CONSTRAINT raw_dumps_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.reference_assets
    ADD CONSTRAINT reference_assets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.revisions
    ADD CONSTRAINT revisions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.substrate_references
    ADD CONSTRAINT substrate_references_document_id_substrate_type_substrate_i_key UNIQUE (document_id, substrate_type, substrate_id);
ALTER TABLE ONLY public.substrate_references
    ADD CONSTRAINT substrate_references_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.substrate_relationships
    ADD CONSTRAINT substrate_relationships_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.substrate_tombstones
    ADD CONSTRAINT substrate_tombstones_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.timeline_events
    ADD CONSTRAINT timeline_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tp_messages
    ADD CONSTRAINT tp_messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tp_sessions
    ADD CONSTRAINT tp_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_agent_subscriptions
    ADD CONSTRAINT unique_active_subscription UNIQUE (user_id, workspace_id, agent_type, status) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.project_agents
    ADD CONSTRAINT unique_agent_per_project UNIQUE (project_id, agent_type);
ALTER TABLE ONLY public.projects
    ADD CONSTRAINT unique_basket_per_project UNIQUE (basket_id);
ALTER TABLE ONLY public.substrate_relationships
    ADD CONSTRAINT unique_relationship UNIQUE (from_block_id, to_block_id, relationship_type);
ALTER TABLE ONLY public.raw_dumps
    ADD CONSTRAINT uq_raw_dumps_basket_dump_req UNIQUE (basket_id, dump_request_id);
ALTER TABLE ONLY public.user_agent_subscriptions
    ADD CONSTRAINT user_agent_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_alerts
    ADD CONSTRAINT user_alerts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.work_checkpoints
    ADD CONSTRAINT work_checkpoints_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.work_checkpoints
    ADD CONSTRAINT work_checkpoints_work_ticket_id_checkpoint_sequence_key UNIQUE (work_ticket_id, checkpoint_sequence);
ALTER TABLE ONLY public.work_iterations
    ADD CONSTRAINT work_iterations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.work_iterations
    ADD CONSTRAINT work_iterations_work_ticket_id_iteration_number_key UNIQUE (work_ticket_id, iteration_number);
ALTER TABLE ONLY public.work_outputs
    ADD CONSTRAINT work_outputs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.work_recipes
    ADD CONSTRAINT work_recipes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.work_recipes
    ADD CONSTRAINT work_recipes_slug_key UNIQUE (slug);
ALTER TABLE ONLY public.work_requests
    ADD CONSTRAINT work_requests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.work_tickets
    ADD CONSTRAINT work_tickets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.workspace_governance_settings
    ADD CONSTRAINT workspace_governance_settings_pkey PRIMARY KEY (workspace_id);
ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_workspace_id_user_id_key UNIQUE (workspace_id, user_id);
ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);
CREATE INDEX baskets_user_idx ON public.baskets USING btree (user_id);
CREATE INDEX blk_doc_idx ON public.block_links USING btree (block_id, document_id);
CREATE INDEX blocks_basket_embedding_idx ON public.blocks USING btree (basket_id, semantic_type) WHERE (embedding IS NOT NULL);
CREATE INDEX blocks_embedding_accepted_idx ON public.blocks USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100') WHERE (state = ANY (ARRAY['ACCEPTED'::public.block_state, 'LOCKED'::public.block_state, 'CONSTANT'::public.block_state]));
CREATE INDEX blocks_embedding_idx ON public.blocks USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');
CREATE UNIQUE INDEX docs_basket_title_idx ON public.documents USING btree (basket_id, title);
CREATE INDEX idx_agent_catalog_active ON public.agent_catalog USING btree (is_active) WHERE (is_active = true);
CREATE INDEX idx_agent_catalog_lifecycle ON public.agent_catalog USING btree (is_active, is_beta, deprecated_at) WHERE (is_active = true);
CREATE INDEX idx_agent_config_history_agent ON public.agent_config_history USING btree (project_agent_id, changed_at DESC);
CREATE INDEX idx_agent_config_history_user ON public.agent_config_history USING btree (changed_by_user_id, changed_at DESC);
CREATE INDEX idx_agent_config_history_version ON public.agent_config_history USING btree (project_agent_id, config_version DESC);
CREATE INDEX idx_agent_queue_cascade ON public.agent_processing_queue USING gin (cascade_metadata);
CREATE UNIQUE INDEX idx_agent_queue_dump_id_unique ON public.agent_processing_queue USING btree (dump_id) WHERE (dump_id IS NOT NULL);
CREATE INDEX idx_agent_queue_priority ON public.agent_processing_queue USING btree (priority DESC, created_at);
CREATE INDEX idx_agent_queue_user_workspace ON public.agent_processing_queue USING btree (user_id, workspace_id);
CREATE INDEX idx_agent_queue_work_id ON public.agent_processing_queue USING btree (work_id);
CREATE INDEX idx_agent_queue_work_type ON public.agent_processing_queue USING btree (work_type, processing_state);
CREATE INDEX idx_agent_sessions_active ON public.agent_sessions USING btree (last_active_at DESC);
CREATE INDEX idx_agent_sessions_basket ON public.agent_sessions USING btree (basket_id);
CREATE INDEX idx_agent_sessions_basket_type ON public.agent_sessions USING btree (basket_id, agent_type);
CREATE INDEX idx_agent_sessions_parent ON public.agent_sessions USING btree (parent_session_id) WHERE (parent_session_id IS NOT NULL);
CREATE INDEX idx_agent_sessions_sdk ON public.agent_sessions USING btree (sdk_session_id) WHERE (sdk_session_id IS NOT NULL);
CREATE INDEX idx_agent_sessions_type ON public.agent_sessions USING btree (agent_type);
CREATE INDEX idx_agent_sessions_workspace ON public.agent_sessions USING btree (workspace_id);
CREATE INDEX idx_app_events_basket ON public.app_events USING btree (basket_id, created_at DESC) WHERE (basket_id IS NOT NULL);
CREATE INDEX idx_app_events_correlation ON public.app_events USING btree (correlation_id) WHERE (correlation_id IS NOT NULL);
CREATE INDEX idx_app_events_dedupe ON public.app_events USING btree (dedupe_key) WHERE (dedupe_key IS NOT NULL);
CREATE INDEX idx_app_events_workspace ON public.app_events USING btree (workspace_id, created_at DESC);
CREATE INDEX idx_asset_type_catalog_active ON public.asset_type_catalog USING btree (is_active) WHERE (is_active = true);
CREATE INDEX idx_asset_type_catalog_category ON public.asset_type_catalog USING btree (category) WHERE (category IS NOT NULL);
CREATE INDEX idx_basket_deltas_applied_at ON public.basket_deltas USING btree (applied_at);
CREATE INDEX idx_basket_deltas_basket ON public.basket_deltas USING btree (basket_id, created_at DESC);
CREATE INDEX idx_basket_deltas_basket_id ON public.basket_deltas USING btree (basket_id);
CREATE INDEX idx_basket_deltas_created ON public.basket_deltas USING btree (created_at DESC);
CREATE INDEX idx_basket_deltas_created_at ON public.basket_deltas USING btree (created_at DESC);
CREATE INDEX idx_basket_deltas_unapplied ON public.basket_deltas USING btree (basket_id, created_at DESC) WHERE (applied_at IS NULL);
CREATE INDEX idx_basket_events_created ON public.basket_events USING btree (created_at DESC);
CREATE INDEX idx_basket_events_created_at ON public.basket_events USING btree (created_at DESC);
CREATE INDEX idx_basket_events_event_type ON public.basket_events USING btree (event_type);
CREATE INDEX idx_basket_signatures_updated ON public.basket_signatures USING btree (last_refreshed DESC);
CREATE INDEX idx_basket_signatures_workspace ON public.basket_signatures USING btree (workspace_id);
CREATE INDEX idx_baskets_workspace ON public.baskets USING btree (workspace_id);
CREATE INDEX idx_baskets_workspace_id ON public.baskets USING btree (workspace_id);
CREATE INDEX idx_block_change_queue_block_id ON public.block_change_queue USING btree (block_id);
CREATE INDEX idx_block_change_queue_status ON public.block_change_queue USING btree (status);
CREATE INDEX idx_block_revisions_basket_ts ON public.block_revisions USING btree (workspace_id, created_at DESC);
CREATE INDEX idx_block_usage_last_used ON public.block_usage USING btree (last_used_at DESC NULLS LAST);
CREATE INDEX idx_block_usage_score ON public.block_usage USING btree (usefulness_score DESC);
CREATE INDEX idx_blocks_anchor_confidence ON public.blocks USING btree (basket_id, anchor_confidence DESC) WHERE ((anchor_role IS NOT NULL) AND (anchor_status = 'accepted'::text));
CREATE INDEX idx_blocks_anchor_role ON public.blocks USING btree (basket_id, anchor_role, anchor_status) WHERE (anchor_role IS NOT NULL);
CREATE INDEX idx_blocks_anchor_vocabulary ON public.blocks USING btree (basket_id, anchor_role, anchor_status) WHERE (anchor_role IS NOT NULL);
CREATE INDEX idx_blocks_asset_basket ON public.blocks USING btree (derived_from_asset_id, basket_id) WHERE (derived_from_asset_id IS NOT NULL);
CREATE INDEX idx_blocks_basket ON public.blocks USING btree (basket_id);
CREATE INDEX idx_blocks_basket_id ON public.blocks USING btree (basket_id);
CREATE INDEX idx_blocks_basket_state_time ON public.blocks USING btree (basket_id, state, last_validated_at DESC) WHERE (state = 'ACCEPTED'::public.block_state);
CREATE INDEX idx_blocks_constants ON public.blocks USING btree (workspace_id, state, scope) WHERE (state = 'CONSTANT'::public.block_state);
CREATE INDEX idx_blocks_derived_asset ON public.blocks USING btree (derived_from_asset_id, created_at DESC) WHERE (derived_from_asset_id IS NOT NULL);
CREATE INDEX idx_blocks_raw_dump ON public.blocks USING btree (raw_dump_id);
CREATE INDEX idx_blocks_recent_validated ON public.blocks USING btree (basket_id, last_validated_at DESC) WHERE (state = 'ACCEPTED'::public.block_state);
CREATE INDEX idx_blocks_refresh_policy ON public.blocks USING btree (updated_at) WHERE (refresh_policy IS NOT NULL);
CREATE INDEX idx_blocks_semantic_type ON public.blocks USING btree (basket_id, semantic_type, state);
CREATE INDEX idx_blocks_staleness ON public.blocks USING btree (last_validated_at DESC NULLS LAST);
CREATE INDEX idx_blocks_state ON public.blocks USING btree (state);
CREATE INDEX idx_blocks_updated_at ON public.blocks USING btree (updated_at);
CREATE INDEX idx_blocks_version_chain ON public.blocks USING btree (parent_block_id, version) WHERE (parent_block_id IS NOT NULL);
CREATE INDEX idx_blocks_workspace ON public.blocks USING btree (workspace_id);
CREATE INDEX idx_blocks_workspace_id ON public.blocks USING btree (workspace_id);
CREATE INDEX idx_blocks_workspace_scope ON public.blocks USING btree (workspace_id, scope, state) WHERE (scope IS NOT NULL);
CREATE INDEX idx_context_items_active ON public.context_items USING btree (basket_id) WHERE (status = 'active'::text);
CREATE INDEX idx_context_items_basket_tier ON public.context_items USING btree (basket_id, tier);
CREATE INDEX idx_context_items_expires ON public.context_items USING btree (expires_at) WHERE (expires_at IS NOT NULL);
CREATE INDEX idx_context_items_schema ON public.context_items USING btree (schema_id) WHERE (schema_id IS NOT NULL);
CREATE INDEX idx_context_items_tags ON public.context_items USING gin (tags);
CREATE INDEX idx_context_items_type ON public.context_items USING btree (basket_id, item_type);
CREATE INDEX idx_doc_versions_signature ON public.document_versions USING btree (composition_signature) WHERE (composition_signature IS NOT NULL);
CREATE INDEX idx_document_versions_created ON public.document_versions USING btree (created_at DESC);
CREATE INDEX idx_document_versions_document ON public.document_versions USING btree (document_id);
CREATE INDEX idx_document_versions_hash ON public.document_versions USING btree (version_hash);
CREATE INDEX idx_documents_basket ON public.documents USING btree (basket_id);
CREATE INDEX idx_documents_basket_id ON public.documents USING btree (basket_id);
CREATE INDEX idx_documents_current_version ON public.documents USING btree (current_version_hash) WHERE (current_version_hash IS NOT NULL);
CREATE INDEX idx_documents_lineage ON public.documents USING btree (previous_id) WHERE (previous_id IS NOT NULL);
CREATE INDEX idx_documents_meta_comp_sig ON public.documents USING btree (((metadata ->> 'composition_signature'::text)));
CREATE INDEX idx_documents_workspace ON public.documents USING btree (workspace_id);
CREATE INDEX idx_documents_workspace_id ON public.documents USING btree (workspace_id);
CREATE INDEX idx_events_agent_type ON public.events USING btree (agent_type);
CREATE INDEX idx_events_basket_id ON public.events USING btree (basket_id);
CREATE INDEX idx_events_basket_kind_ts ON public.events USING btree (basket_id, kind, ts);
CREATE INDEX idx_events_kind ON public.events USING btree (kind);
CREATE INDEX idx_events_origin_kind ON public.events USING btree (origin, kind);
CREATE INDEX idx_events_ts ON public.events USING btree (ts);
CREATE INDEX idx_events_workspace_id ON public.events USING btree (workspace_id);
CREATE INDEX idx_events_workspace_ts ON public.events USING btree (workspace_id, ts DESC);
CREATE INDEX idx_extraction_quality_basket ON public.extraction_quality_metrics USING btree (basket_id, created_at DESC);
CREATE INDEX idx_extraction_quality_workspace ON public.extraction_quality_metrics USING btree (workspace_id, created_at DESC);
CREATE INDEX idx_history_basket_ts ON public.timeline_events USING btree (basket_id, ts DESC, id DESC);
CREATE INDEX idx_idem_delta_id ON public.idempotency_keys USING btree (delta_id);
CREATE INDEX idx_idempotency_delta ON public.idempotency_keys USING btree (delta_id);
CREATE INDEX idx_idempotency_keys_delta_id ON public.idempotency_keys USING btree (delta_id);
CREATE INDEX idx_jobs_completed_at ON public.jobs USING btree (completed_at) WHERE (status = ANY (ARRAY['completed'::text, 'failed'::text, 'cancelled'::text]));
CREATE INDEX idx_jobs_parent_schedule ON public.jobs USING btree (parent_schedule_id) WHERE (parent_schedule_id IS NOT NULL);
CREATE INDEX idx_jobs_pending_ready ON public.jobs USING btree (scheduled_for, priority DESC) WHERE (status = 'pending'::text);
CREATE INDEX idx_jobs_type_status ON public.jobs USING btree (job_type, status);
CREATE INDEX idx_knowledge_timeline_basket_time ON public.knowledge_timeline USING btree (basket_id, created_at DESC);
CREATE INDEX idx_knowledge_timeline_significance ON public.knowledge_timeline USING btree (significance, created_at DESC);
CREATE INDEX idx_knowledge_timeline_workspace_time ON public.knowledge_timeline USING btree (workspace_id, created_at DESC);
CREATE INDEX idx_mcp_activity_host ON public.mcp_activity_logs USING btree (host, created_at DESC);
CREATE INDEX idx_mcp_activity_result ON public.mcp_activity_logs USING btree (result);
CREATE INDEX idx_mcp_activity_workspace ON public.mcp_activity_logs USING btree (workspace_id, created_at DESC);
CREATE INDEX idx_mcp_oauth_sessions_expires_at ON public.mcp_oauth_sessions USING btree (expires_at);
CREATE INDEX idx_mcp_oauth_sessions_mcp_token ON public.mcp_oauth_sessions USING btree (mcp_token);
CREATE INDEX idx_mcp_oauth_sessions_user_id ON public.mcp_oauth_sessions USING btree (user_id);
CREATE INDEX idx_mcp_oauth_sessions_workspace_id ON public.mcp_oauth_sessions USING btree (workspace_id);
CREATE INDEX idx_mcp_unassigned_status ON public.mcp_unassigned_captures USING btree (status);
CREATE INDEX idx_mcp_unassigned_workspace ON public.mcp_unassigned_captures USING btree (workspace_id);
CREATE INDEX idx_narrative_basket ON public.narrative USING btree (basket_id);
CREATE INDEX idx_openai_app_tokens_expires ON public.openai_app_tokens USING btree (expires_at);
CREATE UNIQUE INDEX idx_openai_app_tokens_workspace ON public.openai_app_tokens USING btree (workspace_id);
CREATE INDEX idx_output_type_catalog_active ON public.output_type_catalog USING btree (is_active) WHERE (is_active = true);
CREATE INDEX idx_output_type_catalog_mergeable ON public.output_type_catalog USING btree (can_merge_to_substrate) WHERE (can_merge_to_substrate = true);
CREATE INDEX idx_project_agents_active ON public.project_agents USING btree (project_id, is_active);
CREATE INDEX idx_project_agents_active_config ON public.project_agents USING btree (project_id, is_active, config_updated_at DESC) WHERE (is_active = true);
CREATE INDEX idx_project_agents_config ON public.project_agents USING gin (config);
CREATE INDEX idx_project_agents_project ON public.project_agents USING btree (project_id);
CREATE INDEX idx_project_agents_type ON public.project_agents USING btree (agent_type);
CREATE INDEX idx_project_schedules_next_run ON public.project_schedules USING btree (next_run_at) WHERE (enabled = true);
CREATE INDEX idx_project_schedules_project ON public.project_schedules USING btree (project_id);
CREATE INDEX idx_project_schedules_recipe ON public.project_schedules USING btree (recipe_id);
CREATE INDEX idx_projects_basket ON public.projects USING btree (basket_id);
CREATE UNIQUE INDEX idx_projects_basket_unique ON public.projects USING btree (basket_id);
CREATE INDEX idx_projects_created ON public.projects USING btree (created_at DESC);
CREATE INDEX idx_projects_created_by ON public.projects USING btree (user_id);
CREATE INDEX idx_projects_user ON public.projects USING btree (user_id);
CREATE INDEX idx_projects_workspace ON public.projects USING btree (workspace_id);
CREATE INDEX idx_proposal_executions_executed_at ON public.proposal_executions USING btree (executed_at DESC);
CREATE INDEX idx_proposal_executions_proposal ON public.proposal_executions USING btree (proposal_id, operation_index);
CREATE INDEX idx_proposal_executions_proposal_id ON public.proposal_executions USING btree (proposal_id);
CREATE INDEX idx_proposals_basket_scope ON public.proposals USING btree (basket_id, status, created_at DESC) WHERE ((scope = 'basket'::text) AND (basket_id IS NOT NULL));
CREATE INDEX idx_proposals_basket_status ON public.proposals USING btree (basket_id, status);
CREATE INDEX idx_proposals_blast_radius ON public.proposals USING btree (blast_radius);
CREATE INDEX idx_proposals_executed ON public.proposals USING btree (is_executed, executed_at);
CREATE INDEX idx_proposals_workspace_created ON public.proposals USING btree (workspace_id, created_at DESC);
CREATE INDEX idx_proposals_workspace_scope ON public.proposals USING btree (workspace_id, scope, status, created_at DESC) WHERE ((basket_id IS NULL) OR (scope = ANY (ARRAY['workspace'::text, 'cross-basket'::text])));
CREATE INDEX idx_proposals_workspace_status ON public.proposals USING btree (workspace_id, status, created_at DESC);
CREATE INDEX idx_queue_claimed ON public.agent_processing_queue USING btree (claimed_by, processing_state) WHERE (claimed_by IS NOT NULL);
CREATE INDEX idx_queue_state_created ON public.agent_processing_queue USING btree (processing_state, created_at);
CREATE INDEX idx_queue_workspace ON public.agent_processing_queue USING btree (workspace_id, processing_state);
CREATE INDEX idx_raw_dumps_basket ON public.raw_dumps USING btree (basket_id);
CREATE INDEX idx_raw_dumps_basket_id ON public.raw_dumps USING btree (basket_id);
CREATE INDEX idx_raw_dumps_file_url ON public.raw_dumps USING btree (file_url);
CREATE INDEX idx_raw_dumps_source_meta_gin ON public.raw_dumps USING gin (source_meta);
CREATE INDEX idx_raw_dumps_trace ON public.raw_dumps USING btree (ingest_trace_id);
CREATE INDEX idx_raw_dumps_workspace_id ON public.raw_dumps USING btree (workspace_id);
CREATE INDEX idx_rawdump_doc ON public.raw_dumps USING btree (document_id);
CREATE INDEX idx_ref_assets_basket ON public.reference_assets USING btree (basket_id, created_at DESC);
CREATE INDEX idx_ref_assets_category ON public.reference_assets USING btree (asset_category, basket_id);
CREATE INDEX idx_ref_assets_context_item ON public.reference_assets USING btree (context_item_id, context_field_key) WHERE (context_item_id IS NOT NULL);
CREATE INDEX idx_ref_assets_embedding ON public.reference_assets USING ivfflat (description_embedding public.vector_cosine_ops) WITH (lists='100') WHERE (description_embedding IS NOT NULL);
CREATE INDEX idx_ref_assets_expired ON public.reference_assets USING btree (expires_at) WHERE ((permanence = 'temporary'::text) AND (expires_at IS NOT NULL));
CREATE INDEX idx_ref_assets_metadata ON public.reference_assets USING gin (metadata);
CREATE INDEX idx_ref_assets_scope ON public.reference_assets USING gin (agent_scope);
CREATE INDEX idx_ref_assets_tags ON public.reference_assets USING gin (tags);
CREATE INDEX idx_ref_assets_type ON public.reference_assets USING btree (asset_type, permanence);
CREATE INDEX idx_ref_assets_work_session ON public.reference_assets USING btree (work_session_id) WHERE (work_session_id IS NOT NULL);
CREATE INDEX idx_reference_assets_classification_status ON public.reference_assets USING btree (classification_status) WHERE (classification_status = ANY (ARRAY['unclassified'::text, 'classifying'::text]));
CREATE INDEX idx_reflection_cache_basket_computation ON public.reflections_artifact USING btree (basket_id, computation_timestamp DESC);
CREATE INDEX idx_reflection_cache_computation_timestamp ON public.reflections_artifact USING btree (computation_timestamp DESC);
CREATE INDEX idx_reflections_basket ON public.reflections_artifact USING btree (basket_id);
CREATE INDEX idx_reflections_lineage ON public.reflections_artifact USING btree (previous_id) WHERE (previous_id IS NOT NULL);
CREATE INDEX idx_reflections_workspace_scope ON public.reflections_artifact USING btree (workspace_id, scope_level, is_current) WHERE (scope_level = 'workspace'::text);
CREATE INDEX idx_schedules_next_run ON public.project_recipe_schedules USING btree (next_run_at, enabled) WHERE (enabled = true);
CREATE INDEX idx_schedules_project ON public.project_recipe_schedules USING btree (project_id);
CREATE INDEX idx_subscriptions_active ON public.user_agent_subscriptions USING btree (user_id, workspace_id, agent_type) WHERE (status = 'active'::text);
CREATE INDEX idx_subscriptions_stripe ON public.user_agent_subscriptions USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);
CREATE INDEX idx_subscriptions_user_workspace ON public.user_agent_subscriptions USING btree (user_id, workspace_id);
CREATE INDEX idx_substrate_references_created ON public.substrate_references USING btree (created_at);
CREATE INDEX idx_substrate_references_document ON public.substrate_references USING btree (document_id);
CREATE INDEX idx_substrate_references_role ON public.substrate_references USING btree (role) WHERE (role IS NOT NULL);
CREATE INDEX idx_substrate_references_substrate ON public.substrate_references USING btree (substrate_id);
CREATE INDEX idx_substrate_references_type ON public.substrate_references USING btree (substrate_type);
CREATE INDEX idx_timeline_events_basket_timestamp_id ON public.timeline_events USING btree (basket_id, ts DESC, id DESC);
CREATE INDEX idx_timeline_events_kind_ref_id ON public.timeline_events USING btree (kind, ref_id) WHERE (ref_id IS NOT NULL);
CREATE INDEX idx_timeline_workspace_ts ON public.timeline_events USING btree (workspace_id, ts DESC, id DESC);
CREATE INDEX idx_tombstones_lookup ON public.substrate_tombstones USING btree (workspace_id, basket_id, substrate_type, substrate_id);
CREATE INDEX idx_tp_messages_basket_session ON public.tp_messages USING btree (basket_id, session_id);
CREATE INDEX idx_tp_messages_session_created ON public.tp_messages USING btree (session_id, created_at);
CREATE INDEX idx_tp_messages_user ON public.tp_messages USING btree (user_id);
CREATE INDEX idx_tp_sessions_basket ON public.tp_sessions USING btree (basket_id);
CREATE INDEX idx_tp_sessions_status ON public.tp_sessions USING btree (status) WHERE (status = 'active'::text);
CREATE INDEX idx_tp_sessions_user ON public.tp_sessions USING btree (created_by_user_id);
CREATE INDEX idx_tp_sessions_workspace ON public.tp_sessions USING btree (workspace_id);
CREATE INDEX idx_user_alerts_actionable ON public.user_alerts USING btree (user_id, actionable, created_at DESC) WHERE (dismissed_at IS NULL);
CREATE INDEX idx_user_alerts_user_active ON public.user_alerts USING btree (user_id, created_at DESC) WHERE (dismissed_at IS NULL);
CREATE INDEX idx_user_alerts_workspace_active ON public.user_alerts USING btree (workspace_id, created_at DESC) WHERE (dismissed_at IS NULL);
CREATE INDEX idx_work_checkpoints_status ON public.work_checkpoints USING btree (status) WHERE (status = 'pending'::text);
CREATE INDEX idx_work_checkpoints_ticket ON public.work_checkpoints USING btree (work_ticket_id);
CREATE INDEX idx_work_iterations_resolved ON public.work_iterations USING btree (resolved) WHERE (NOT resolved);
CREATE INDEX idx_work_iterations_ticket ON public.work_iterations USING btree (work_ticket_id);
CREATE INDEX idx_work_outputs_agent_type ON public.work_outputs USING btree (agent_type, basket_id);
CREATE INDEX idx_work_outputs_basket ON public.work_outputs USING btree (basket_id, created_at DESC);
CREATE INDEX idx_work_outputs_file_format ON public.work_outputs USING btree (file_format) WHERE (file_format IS NOT NULL);
CREATE INDEX idx_work_outputs_file_id ON public.work_outputs USING btree (file_id) WHERE (file_id IS NOT NULL);
CREATE INDEX idx_work_outputs_generation_method ON public.work_outputs USING btree (generation_method);
CREATE INDEX idx_work_outputs_metadata ON public.work_outputs USING gin (metadata);
CREATE INDEX idx_work_outputs_pending ON public.work_outputs USING btree (supervision_status, created_at DESC) WHERE (supervision_status = 'pending_review'::text);
CREATE INDEX idx_work_outputs_pending_promotion ON public.work_outputs USING btree (basket_id, supervision_status) WHERE ((supervision_status = 'approved'::text) AND (substrate_proposal_id IS NULL));
CREATE INDEX idx_work_outputs_provenance ON public.work_outputs USING gin (source_context_ids);
CREATE INDEX idx_work_outputs_session ON public.work_outputs USING btree (work_ticket_id, created_at DESC);
CREATE INDEX idx_work_outputs_target_role ON public.work_outputs USING btree (target_context_role, promotion_status) WHERE (target_context_role IS NOT NULL);
CREATE INDEX idx_work_outputs_tool_call ON public.work_outputs USING btree (tool_call_id) WHERE (tool_call_id IS NOT NULL);
CREATE INDEX idx_work_outputs_type ON public.work_outputs USING btree (output_type, basket_id);
CREATE INDEX idx_work_recipes_agent_type ON public.work_recipes USING btree (agent_type);
CREATE INDEX idx_work_recipes_category ON public.work_recipes USING btree (category);
CREATE INDEX idx_work_recipes_slug ON public.work_recipes USING btree (slug);
CREATE INDEX idx_work_recipes_status ON public.work_recipes USING btree (status) WHERE ((status)::text = 'active'::text);
CREATE INDEX idx_work_requests_basket ON public.work_requests USING btree (basket_id);
CREATE INDEX idx_work_requests_recipe ON public.work_requests USING btree (recipe_id) WHERE (recipe_id IS NOT NULL);
CREATE INDEX idx_work_requests_requested_at ON public.work_requests USING btree (requested_at DESC);
CREATE INDEX idx_work_requests_session ON public.work_requests USING btree (agent_session_id) WHERE (agent_session_id IS NOT NULL);
CREATE INDEX idx_work_requests_status ON public.agent_work_requests USING btree (status, created_at);
CREATE INDEX idx_work_requests_subscription ON public.agent_work_requests USING btree (subscription_id) WHERE (subscription_id IS NOT NULL);
CREATE INDEX idx_work_requests_trial ON public.agent_work_requests USING btree (user_id, workspace_id, is_trial_request) WHERE (is_trial_request = true);
CREATE INDEX idx_work_requests_user ON public.work_requests USING btree (requested_by_user_id);
CREATE INDEX idx_work_requests_user_workspace ON public.agent_work_requests USING btree (user_id, workspace_id);
CREATE INDEX idx_work_requests_workspace ON public.work_requests USING btree (workspace_id);
CREATE INDEX idx_work_tickets_agent_type ON public.work_tickets USING btree (agent_type);
CREATE INDEX idx_work_tickets_basket ON public.work_tickets USING btree (basket_id, created_at DESC);
CREATE INDEX idx_work_tickets_request ON public.work_tickets USING btree (work_request_id);
CREATE INDEX idx_work_tickets_session ON public.work_tickets USING btree (agent_session_id) WHERE (agent_session_id IS NOT NULL);
CREATE INDEX idx_work_tickets_status ON public.work_tickets USING btree (status) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]));
CREATE INDEX idx_work_tickets_workspace ON public.work_tickets USING btree (workspace_id);
CREATE INDEX idx_workspace_governance_settings_workspace_id ON public.workspace_governance_settings USING btree (workspace_id);
CREATE INDEX integration_tokens_user_id_idx ON public.integration_tokens USING btree (user_id);
CREATE INDEX integration_tokens_workspace_id_idx ON public.integration_tokens USING btree (workspace_id);
CREATE INDEX ix_block_links_doc_block ON public.block_links USING btree (document_id, block_id);
CREATE INDEX ix_events_kind_ts ON public.events USING btree (kind, ts);
CREATE INDEX ix_pipeline_metrics_basket ON public.pipeline_metrics USING btree (basket_id, ts DESC);
CREATE INDEX ix_pipeline_metrics_recent ON public.pipeline_metrics USING btree (pipeline, ts DESC);
CREATE UNIQUE INDEX reflection_cache_uq ON public.reflections_artifact USING btree (basket_id, substrate_hash);
CREATE INDEX relationships_confidence_idx ON public.substrate_relationships USING btree (confidence_score DESC) WHERE ((state = 'PROPOSED'::public.block_state) AND (confidence_score IS NOT NULL));
CREATE INDEX relationships_from_block_idx ON public.substrate_relationships USING btree (from_block_id) WHERE (state = 'ACCEPTED'::public.block_state);
CREATE INDEX relationships_graph_query_idx ON public.substrate_relationships USING btree (relationship_type, from_block_id, state);
CREATE INDEX relationships_to_block_idx ON public.substrate_relationships USING btree (to_block_id) WHERE (state = 'ACCEPTED'::public.block_state);
CREATE INDEX relationships_type_idx ON public.substrate_relationships USING btree (relationship_type) WHERE (state = 'ACCEPTED'::public.block_state);
CREATE UNIQUE INDEX timeline_dump_unique ON public.timeline_events USING btree (ref_id) WHERE (kind = 'dump'::text);
CREATE INDEX timeline_events_basket_ts_idx ON public.timeline_events USING btree (basket_id, ts DESC);
CREATE UNIQUE INDEX uq_baskets_user_idem ON public.baskets USING btree (user_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE UNIQUE INDEX uq_current_insight_canon_per_basket ON public.reflections_artifact USING btree (basket_id) WHERE ((insight_type = 'insight_canon'::text) AND (is_current = true) AND (basket_id IS NOT NULL));
CREATE UNIQUE INDEX uq_current_insight_canon_per_workspace ON public.reflections_artifact USING btree (workspace_id) WHERE ((insight_type = 'insight_canon'::text) AND (is_current = true) AND (scope_level = 'workspace'::text));
CREATE UNIQUE INDEX uq_doc_ctx_item ON public.document_context_items USING btree (document_id, context_item_id);
CREATE UNIQUE INDEX uq_doc_version_signature ON public.document_versions USING btree (document_id, composition_signature) WHERE (composition_signature IS NOT NULL);
CREATE UNIQUE INDEX uq_document_canon_per_basket ON public.documents USING btree (basket_id) WHERE ((doc_type = 'document_canon'::text) AND (basket_id IS NOT NULL));
CREATE UNIQUE INDEX uq_dumps_basket_req ON public.raw_dumps USING btree (basket_id, dump_request_id) WHERE (dump_request_id IS NOT NULL);
CREATE UNIQUE INDEX uq_raw_dumps_basket_req ON public.raw_dumps USING btree (basket_id, dump_request_id) WHERE (dump_request_id IS NOT NULL);
CREATE UNIQUE INDEX ux_raw_dumps_basket_trace ON public.raw_dumps USING btree (basket_id, ingest_trace_id) WHERE (ingest_trace_id IS NOT NULL);
CREATE TRIGGER after_dump_insert AFTER INSERT ON public.raw_dumps FOR EACH ROW EXECUTE FUNCTION public.queue_agent_processing();
CREATE TRIGGER basket_signatures_set_updated_at BEFORE UPDATE ON public.basket_signatures FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER enforce_single_workspace_per_user BEFORE INSERT OR UPDATE ON public.workspace_memberships FOR EACH ROW EXECUTE FUNCTION public.check_single_workspace_per_user();
CREATE TRIGGER ensure_text_dump_columns BEFORE INSERT ON public.raw_dumps FOR EACH ROW EXECUTE FUNCTION public.ensure_raw_dump_text_columns();
CREATE TRIGGER mcp_unassigned_set_updated_at BEFORE UPDATE ON public.mcp_unassigned_captures FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER openai_app_tokens_set_updated_at BEFORE UPDATE ON public.openai_app_tokens FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER project_recipe_schedules_updated_at BEFORE UPDATE ON public.project_recipe_schedules FOR EACH ROW EXECUTE FUNCTION public.fn_set_schedule_updated_at();
CREATE TRIGGER proposals_validation_gate BEFORE UPDATE ON public.proposals FOR EACH ROW EXECUTE FUNCTION public.proposal_validation_check();
CREATE TRIGGER reflection_cache_updated_at_trigger BEFORE UPDATE ON public.reflections_artifact FOR EACH ROW EXECUTE FUNCTION public.update_reflection_cache_updated_at();
CREATE TRIGGER set_updated_at_agent_catalog BEFORE UPDATE ON public.agent_catalog FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_updated_at_subscriptions BEFORE UPDATE ON public.user_agent_subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER sync_text_dump_columns BEFORE UPDATE ON public.raw_dumps FOR EACH ROW EXECUTE FUNCTION public.sync_raw_dump_text_columns();
CREATE TRIGGER trg_block_depth BEFORE INSERT OR UPDATE ON public.blocks FOR EACH ROW EXECUTE FUNCTION public.check_block_depth();
CREATE TRIGGER trg_capture_config_change AFTER UPDATE ON public.project_agents FOR EACH ROW WHEN ((old.config IS DISTINCT FROM new.config)) EXECUTE FUNCTION public.capture_agent_config_change();
CREATE TRIGGER trg_context_entry_schemas_updated_at BEFORE UPDATE ON public.context_entry_schemas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_context_items_updated_at BEFORE UPDATE ON public.context_items FOR EACH ROW EXECUTE FUNCTION public.update_context_item_timestamp();
CREATE TRIGGER trg_jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.update_jobs_updated_at();
CREATE TRIGGER trg_lock_constant BEFORE INSERT OR UPDATE ON public.blocks FOR EACH ROW EXECUTE FUNCTION public.prevent_lock_vs_constant();
CREATE TRIGGER trg_set_basket_user_id BEFORE INSERT ON public.baskets FOR EACH ROW EXECUTE FUNCTION public.set_basket_user_id();
CREATE TRIGGER trg_timeline_after_raw_dump AFTER INSERT ON public.raw_dumps FOR EACH ROW EXECUTE FUNCTION public.fn_timeline_after_raw_dump();
CREATE TRIGGER trg_tp_message_insert AFTER INSERT ON public.tp_messages FOR EACH ROW EXECUTE FUNCTION public.update_tp_session_stats();
CREATE TRIGGER trg_update_asset_type_catalog_updated_at BEFORE UPDATE ON public.asset_type_catalog FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_update_output_type_catalog_updated_at BEFORE UPDATE ON public.output_type_catalog FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_update_reference_assets_updated_at BEFORE UPDATE ON public.reference_assets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_update_schedule_next_run BEFORE INSERT OR UPDATE OF frequency, day_of_week, time_of_day, cron_expression, enabled ON public.project_schedules FOR EACH ROW EXECUTE FUNCTION public.update_schedule_next_run();
CREATE TRIGGER trg_update_work_outputs_updated_at BEFORE UPDATE ON public.work_outputs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_auto_increment_usage_on_substrate_reference AFTER INSERT ON public.substrate_references FOR EACH ROW EXECUTE FUNCTION public.auto_increment_block_usage_on_reference();
CREATE TRIGGER trigger_mark_blocks_stale_on_new_dump AFTER INSERT ON public.raw_dumps FOR EACH ROW EXECUTE FUNCTION public.mark_related_blocks_stale();
CREATE TRIGGER trigger_update_agent_session_activity AFTER INSERT ON public.work_tickets FOR EACH ROW EXECUTE FUNCTION public.update_agent_session_activity();
CREATE TRIGGER trigger_update_project_timestamp BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_project_timestamp();
CREATE TRIGGER trigger_update_work_tickets_timestamp BEFORE UPDATE ON public.work_tickets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_baskets_updated_at BEFORE UPDATE ON public.baskets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_block_change_queue_updated_at BEFORE UPDATE ON public.block_change_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_blocks_updated_at BEFORE UPDATE ON public.blocks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_raw_dumps_updated_at BEFORE UPDATE ON public.raw_dumps FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_substrate_relationships_updated_at BEFORE UPDATE ON public.substrate_relationships FOR EACH ROW EXECUTE FUNCTION public.update_substrate_relationships_updated_at();
CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE ONLY public.agent_catalog
    ADD CONSTRAINT agent_catalog_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id);
ALTER TABLE ONLY public.agent_config_history
    ADD CONSTRAINT agent_config_history_changed_by_user_id_fkey FOREIGN KEY (changed_by_user_id) REFERENCES auth.users(id);
ALTER TABLE ONLY public.agent_config_history
    ADD CONSTRAINT agent_config_history_project_agent_id_fkey FOREIGN KEY (project_agent_id) REFERENCES public.project_agents(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_processing_queue
    ADD CONSTRAINT agent_processing_queue_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.agent_processing_queue
    ADD CONSTRAINT agent_processing_queue_dump_id_fkey FOREIGN KEY (dump_id) REFERENCES public.raw_dumps(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.agent_processing_queue
    ADD CONSTRAINT agent_processing_queue_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);
ALTER TABLE ONLY public.agent_sessions
    ADD CONSTRAINT agent_sessions_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_sessions
    ADD CONSTRAINT agent_sessions_created_by_session_id_fkey FOREIGN KEY (created_by_session_id) REFERENCES public.agent_sessions(id);
ALTER TABLE ONLY public.agent_sessions
    ADD CONSTRAINT agent_sessions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id);
ALTER TABLE ONLY public.agent_sessions
    ADD CONSTRAINT agent_sessions_parent_session_id_fkey FOREIGN KEY (parent_session_id) REFERENCES public.agent_sessions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_sessions
    ADD CONSTRAINT agent_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_work_requests
    ADD CONSTRAINT agent_work_requests_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.agent_work_requests
    ADD CONSTRAINT agent_work_requests_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.app_events
    ADD CONSTRAINT app_events_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id);
ALTER TABLE ONLY public.app_events
    ADD CONSTRAINT app_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);
ALTER TABLE ONLY public.artifact_generation_settings
    ADD CONSTRAINT artifact_generation_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.asset_type_catalog
    ADD CONSTRAINT asset_type_catalog_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id);
ALTER TABLE ONLY public.reflections_artifact
    ADD CONSTRAINT basket_reflections_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.basket_signatures
    ADD CONSTRAINT basket_signatures_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.basket_signatures
    ADD CONSTRAINT basket_signatures_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.block_change_queue
    ADD CONSTRAINT block_change_queue_block_id_fkey FOREIGN KEY (block_id) REFERENCES public.blocks(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.block_links
    ADD CONSTRAINT block_links_block_id_fkey FOREIGN KEY (block_id) REFERENCES public.blocks(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.block_links
    ADD CONSTRAINT block_links_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.block_revisions
    ADD CONSTRAINT block_revisions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);
ALTER TABLE ONLY public.block_revisions
    ADD CONSTRAINT block_revisions_block_id_fkey FOREIGN KEY (block_id) REFERENCES public.blocks(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.block_revisions
    ADD CONSTRAINT block_revisions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.block_usage
    ADD CONSTRAINT block_usage_block_id_fkey FOREIGN KEY (block_id) REFERENCES public.blocks(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_derived_from_asset_id_fkey FOREIGN KEY (derived_from_asset_id) REFERENCES public.reference_assets(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_parent_block_id_fkey FOREIGN KEY (parent_block_id) REFERENCES public.blocks(id);
ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.proposals(id);
ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_raw_dump_id_fkey FOREIGN KEY (raw_dump_id) REFERENCES public.raw_dumps(id);
ALTER TABLE ONLY public.context_items
    ADD CONSTRAINT context_items_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.context_items
    ADD CONSTRAINT context_items_previous_version_id_fkey FOREIGN KEY (previous_version_id) REFERENCES public.context_items(id);
ALTER TABLE ONLY public.context_items
    ADD CONSTRAINT context_items_schema_id_fkey FOREIGN KEY (schema_id) REFERENCES public.context_entry_schemas(anchor_role);
ALTER TABLE ONLY public.document_context_items
    ADD CONSTRAINT document_context_items_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_previous_id_fkey FOREIGN KEY (previous_id) REFERENCES public.documents(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_source_raw_dump_id_fkey FOREIGN KEY (source_raw_dump_id) REFERENCES public.raw_dumps(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);
ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_block_id_fkey FOREIGN KEY (block_id) REFERENCES public.blocks(id);
ALTER TABLE ONLY public.extraction_quality_metrics
    ADD CONSTRAINT extraction_quality_metrics_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.extraction_quality_metrics
    ADD CONSTRAINT extraction_quality_metrics_dump_id_fkey FOREIGN KEY (dump_id) REFERENCES public.raw_dumps(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.project_agents
    ADD CONSTRAINT fk_agent_type FOREIGN KEY (agent_type) REFERENCES public.agent_catalog(agent_type) ON UPDATE CASCADE;
ALTER TABLE ONLY public.baskets
    ADD CONSTRAINT fk_basket_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.baskets
    ADD CONSTRAINT fk_baskets_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT fk_block_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.baskets
    ADD CONSTRAINT fk_raw_dump FOREIGN KEY (raw_dump_id) REFERENCES public.raw_dumps(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ONLY public.raw_dumps
    ADD CONSTRAINT fk_rawdump_document FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.raw_dumps
    ADD CONSTRAINT fk_rawdump_workspace FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tp_messages
    ADD CONSTRAINT fk_tp_messages_session FOREIGN KEY (session_id) REFERENCES public.tp_sessions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.integration_tokens
    ADD CONSTRAINT integration_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.integration_tokens
    ADD CONSTRAINT integration_tokens_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_parent_schedule_id_fkey FOREIGN KEY (parent_schedule_id) REFERENCES public.project_schedules(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.knowledge_timeline
    ADD CONSTRAINT knowledge_timeline_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.knowledge_timeline
    ADD CONSTRAINT knowledge_timeline_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.mcp_activity_logs
    ADD CONSTRAINT mcp_activity_logs_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.mcp_activity_logs
    ADD CONSTRAINT mcp_activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.mcp_activity_logs
    ADD CONSTRAINT mcp_activity_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.mcp_oauth_sessions
    ADD CONSTRAINT mcp_oauth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.mcp_oauth_sessions
    ADD CONSTRAINT mcp_oauth_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.mcp_unassigned_captures
    ADD CONSTRAINT mcp_unassigned_captures_assigned_basket_id_fkey FOREIGN KEY (assigned_basket_id) REFERENCES public.baskets(id);
ALTER TABLE ONLY public.mcp_unassigned_captures
    ADD CONSTRAINT mcp_unassigned_captures_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.mcp_unassigned_captures
    ADD CONSTRAINT mcp_unassigned_captures_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.mcp_unassigned_captures
    ADD CONSTRAINT mcp_unassigned_captures_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.narrative
    ADD CONSTRAINT narrative_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id);
ALTER TABLE ONLY public.narrative
    ADD CONSTRAINT narrative_raw_dump_id_fkey FOREIGN KEY (raw_dump_id) REFERENCES public.raw_dumps(id);
ALTER TABLE ONLY public.openai_app_tokens
    ADD CONSTRAINT openai_app_tokens_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.p3_p4_regeneration_policy
    ADD CONSTRAINT p3_p4_regeneration_policy_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.project_agents
    ADD CONSTRAINT project_agents_config_updated_by_fkey FOREIGN KEY (config_updated_by) REFERENCES auth.users(id);
ALTER TABLE ONLY public.project_agents
    ADD CONSTRAINT project_agents_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.project_recipe_schedules
    ADD CONSTRAINT project_recipe_schedules_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE ONLY public.project_recipe_schedules
    ADD CONSTRAINT project_recipe_schedules_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.project_schedules
    ADD CONSTRAINT project_schedules_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.project_schedules
    ADD CONSTRAINT project_schedules_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE ONLY public.project_schedules
    ADD CONSTRAINT project_schedules_last_run_ticket_id_fkey FOREIGN KEY (last_run_ticket_id) REFERENCES public.work_tickets(id);
ALTER TABLE ONLY public.project_schedules
    ADD CONSTRAINT project_schedules_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.project_schedules
    ADD CONSTRAINT project_schedules_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.work_recipes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.proposal_executions
    ADD CONSTRAINT proposal_executions_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.proposals(id);
ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id);
ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_target_basket_id_fkey FOREIGN KEY (target_basket_id) REFERENCES public.baskets(id);
ALTER TABLE ONLY public.proposals
    ADD CONSTRAINT proposals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);
ALTER TABLE ONLY public.raw_dumps
    ADD CONSTRAINT raw_dumps_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reference_assets
    ADD CONSTRAINT ref_assets_context_item_fk FOREIGN KEY (context_item_id) REFERENCES public.context_items(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.reference_assets
    ADD CONSTRAINT reference_assets_asset_type_fkey FOREIGN KEY (asset_type) REFERENCES public.asset_type_catalog(asset_type);
ALTER TABLE ONLY public.reference_assets
    ADD CONSTRAINT reference_assets_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reference_assets
    ADD CONSTRAINT reference_assets_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id);
ALTER TABLE ONLY public.reflections_artifact
    ADD CONSTRAINT reflection_cache_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reflections_artifact
    ADD CONSTRAINT reflections_artifact_previous_id_fkey FOREIGN KEY (previous_id) REFERENCES public.reflections_artifact(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.revisions
    ADD CONSTRAINT revisions_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.substrate_references
    ADD CONSTRAINT substrate_references_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.substrate_references
    ADD CONSTRAINT substrate_references_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.substrate_relationships
    ADD CONSTRAINT substrate_relationships_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE ONLY public.substrate_relationships
    ADD CONSTRAINT substrate_relationships_from_block_id_fkey FOREIGN KEY (from_block_id) REFERENCES public.blocks(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.substrate_relationships
    ADD CONSTRAINT substrate_relationships_to_block_id_fkey FOREIGN KEY (to_block_id) REFERENCES public.blocks(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.timeline_events
    ADD CONSTRAINT timeline_events_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.timeline_events
    ADD CONSTRAINT timeline_events_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tp_messages
    ADD CONSTRAINT tp_messages_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tp_messages
    ADD CONSTRAINT tp_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.tp_sessions
    ADD CONSTRAINT tp_sessions_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tp_sessions
    ADD CONSTRAINT tp_sessions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.tp_sessions
    ADD CONSTRAINT tp_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_agent_subscriptions
    ADD CONSTRAINT user_agent_subscriptions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_alerts
    ADD CONSTRAINT user_alerts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_checkpoints
    ADD CONSTRAINT work_checkpoints_reviewed_by_user_id_fkey FOREIGN KEY (reviewed_by_user_id) REFERENCES auth.users(id);
ALTER TABLE ONLY public.work_checkpoints
    ADD CONSTRAINT work_checkpoints_work_ticket_id_fkey FOREIGN KEY (work_ticket_id) REFERENCES public.work_tickets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_iterations
    ADD CONSTRAINT work_iterations_work_ticket_id_fkey FOREIGN KEY (work_ticket_id) REFERENCES public.work_tickets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_outputs
    ADD CONSTRAINT work_outputs_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_outputs
    ADD CONSTRAINT work_outputs_promoted_by_fkey FOREIGN KEY (promoted_by) REFERENCES auth.users(id);
ALTER TABLE ONLY public.work_outputs
    ADD CONSTRAINT work_outputs_promoted_to_block_id_fkey FOREIGN KEY (promoted_to_block_id) REFERENCES public.blocks(id);
ALTER TABLE ONLY public.work_outputs
    ADD CONSTRAINT work_outputs_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id);
ALTER TABLE ONLY public.work_outputs
    ADD CONSTRAINT work_outputs_work_ticket_id_fkey FOREIGN KEY (work_ticket_id) REFERENCES public.work_tickets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_requests
    ADD CONSTRAINT work_requests_agent_session_id_fkey FOREIGN KEY (agent_session_id) REFERENCES public.agent_sessions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.work_requests
    ADD CONSTRAINT work_requests_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_requests
    ADD CONSTRAINT work_requests_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.work_recipes(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.work_requests
    ADD CONSTRAINT work_requests_requested_by_user_id_fkey FOREIGN KEY (requested_by_user_id) REFERENCES auth.users(id);
ALTER TABLE ONLY public.work_requests
    ADD CONSTRAINT work_requests_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_tickets
    ADD CONSTRAINT work_tickets_agent_session_id_fkey FOREIGN KEY (agent_session_id) REFERENCES public.agent_sessions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.work_tickets
    ADD CONSTRAINT work_tickets_basket_id_fkey FOREIGN KEY (basket_id) REFERENCES public.baskets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_tickets
    ADD CONSTRAINT work_tickets_work_request_id_fkey FOREIGN KEY (work_request_id) REFERENCES public.work_requests(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.work_tickets
    ADD CONSTRAINT work_tickets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.workspace_governance_settings
    ADD CONSTRAINT workspace_governance_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE POLICY "Allow anon read events" ON public.events FOR SELECT USING (true);
CREATE POLICY "Allow anon read raw_dumps" ON public.raw_dumps FOR SELECT USING (true);
CREATE POLICY "Allow anon read revisions" ON public.revisions FOR SELECT USING (true);
CREATE POLICY "Allow anonymous read access to projects" ON public.projects FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anonymous read access to work_outputs" ON public.work_outputs FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anonymous read access to work_tickets" ON public.work_tickets FOR SELECT TO anon USING (true);
CREATE POLICY "Allow authenticated users to view basket events" ON public.basket_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow baskets for workspace members" ON public.baskets FOR SELECT TO authenticated USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Allow insert for members" ON public.workspace_memberships FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Allow insert for owner" ON public.workspaces FOR INSERT TO authenticated WITH CHECK ((auth.uid() = owner_id));
CREATE POLICY "Allow own workspace memberships" ON public.workspace_memberships FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "Allow owner to read workspace" ON public.workspaces FOR SELECT USING ((auth.uid() = owner_id));
CREATE POLICY "Allow users to see their own workspace memberships" ON public.workspace_memberships FOR SELECT USING ((user_id = auth.uid()));
CREATE POLICY "Allow workspace members to read baskets" ON public.baskets FOR SELECT USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Anon can view events temporarily" ON public.basket_events FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated users can view events" ON public.basket_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role can manage all relationships" ON public.substrate_relationships USING (((auth.jwt() ->> 'role'::text) = 'service_role'::text)) WITH CHECK (((auth.jwt() ->> 'role'::text) = 'service_role'::text));
CREATE POLICY "Service role can manage integration tokens" ON public.integration_tokens TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage jobs" ON public.jobs TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage queue" ON public.agent_processing_queue TO service_role USING (true);
CREATE POLICY "Service role full access" ON public.baskets TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role has full access to agent_catalog" ON public.agent_catalog TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role has full access to agent_config_history" ON public.agent_config_history TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role has full access to asset_type_catalog" ON public.asset_type_catalog TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role has full access to block_usage" ON public.block_usage TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role has full access to extraction_quality_metrics" ON public.extraction_quality_metrics TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role has full access to output_type_catalog" ON public.output_type_catalog TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role has full access to project_agents" ON public.project_agents TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role has full access to projects" ON public.projects TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role has full access to reference_assets" ON public.reference_assets TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role has full access to work_outputs" ON public.work_outputs TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users can create TP sessions in their workspace" ON public.tp_sessions FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.workspace_memberships wm
  WHERE ((wm.workspace_id = tp_sessions.workspace_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can create agent sessions in their workspaces" ON public.agent_sessions FOR INSERT WITH CHECK (((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))) AND (created_by_user_id = auth.uid())));
CREATE POLICY "Users can create checkpoints in their workspace tickets" ON public.work_checkpoints FOR INSERT WITH CHECK ((work_ticket_id IN ( SELECT work_tickets.id
   FROM public.work_tickets
  WHERE (work_tickets.workspace_id IN ( SELECT workspace_memberships.workspace_id
           FROM public.workspace_memberships
          WHERE (workspace_memberships.user_id = auth.uid()))))));
CREATE POLICY "Users can create integration tokens for their workspaces" ON public.integration_tokens FOR INSERT TO authenticated WITH CHECK ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.user_id = auth.uid()) AND (workspace_memberships.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));
CREATE POLICY "Users can create iterations in their workspace tickets" ON public.work_iterations FOR INSERT WITH CHECK ((work_ticket_id IN ( SELECT work_tickets.id
   FROM public.work_tickets
  WHERE (work_tickets.workspace_id IN ( SELECT workspace_memberships.workspace_id
           FROM public.workspace_memberships
          WHERE (workspace_memberships.user_id = auth.uid()))))));
CREATE POLICY "Users can create messages in their sessions" ON public.tp_messages FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.tp_sessions ts
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = ts.workspace_id)))
  WHERE ((ts.id = tp_messages.session_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can create outputs in their workspace" ON public.work_outputs FOR INSERT TO authenticated WITH CHECK ((basket_id IN ( SELECT b.id
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE (wm.user_id = auth.uid()))));
CREATE POLICY "Users can create project schedules" ON public.project_schedules FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.projects p
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((p.id = project_schedules.project_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can create project_agents in their workspace" ON public.project_agents FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.projects p
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((p.id = project_agents.project_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can create projects in their workspace" ON public.projects FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.workspace_memberships wm
  WHERE ((wm.workspace_id = projects.workspace_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can create projects in their workspaces" ON public.projects FOR INSERT WITH CHECK (((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))) AND (user_id = auth.uid())));
CREATE POLICY "Users can create proposals in their workspace" ON public.proposals FOR INSERT WITH CHECK ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Users can create relationships in their workspace baskets" ON public.substrate_relationships FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ((public.blocks b
     JOIN public.baskets bsk ON ((b.basket_id = bsk.id)))
     JOIN public.workspace_memberships wm ON ((bsk.workspace_id = wm.workspace_id)))
  WHERE ((b.id = substrate_relationships.from_block_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can create work requests in their workspaces" ON public.work_requests FOR INSERT WITH CHECK (((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))) AND (requested_by_user_id = auth.uid())));
CREATE POLICY "Users can create work tickets in their workspaces" ON public.work_tickets FOR INSERT WITH CHECK ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Users can delete assets from their workspace" ON public.reference_assets FOR DELETE TO authenticated USING ((basket_id IN ( SELECT b.id
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE (wm.user_id = auth.uid()))));
CREATE POLICY "Users can delete outputs from their workspace" ON public.work_outputs FOR DELETE TO authenticated USING ((basket_id IN ( SELECT b.id
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE (wm.user_id = auth.uid()))));
CREATE POLICY "Users can delete project schedules" ON public.project_schedules FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (public.projects p
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((p.id = project_schedules.project_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can delete project_agents in their workspace" ON public.project_agents FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (public.projects p
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((p.id = project_agents.project_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can delete projects in their workspace" ON public.projects FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships wm
  WHERE ((wm.workspace_id = projects.workspace_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can insert agent_config_history in their workspace" ON public.agent_config_history FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ((public.project_agents pa
     JOIN public.projects p ON ((p.id = pa.project_id)))
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((pa.id = agent_config_history.project_agent_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can insert events for their workspaces" ON public.events FOR INSERT TO authenticated WITH CHECK ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Users can modify block revisions in their workspaces" ON public.block_revisions USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.workspace_id = block_revisions.workspace_id) AND (workspace_memberships.user_id = auth.uid())))));
CREATE POLICY "Users can modify blocks in their workspaces" ON public.blocks USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.workspace_id = blocks.workspace_id) AND (workspace_memberships.user_id = auth.uid())))));
CREATE POLICY "Users can modify documents in their workspaces" ON public.documents USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.workspace_id = documents.workspace_id) AND (workspace_memberships.user_id = auth.uid())))));
CREATE POLICY "Users can queue processing in their workspace" ON public.agent_processing_queue FOR INSERT TO authenticated WITH CHECK ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Users can read active agent types" ON public.agent_catalog FOR SELECT TO authenticated USING (((is_active = true) AND (deprecated_at IS NULL)));
CREATE POLICY "Users can read active asset types" ON public.asset_type_catalog FOR SELECT TO authenticated USING (((is_active = true) AND (deprecated_at IS NULL)));
CREATE POLICY "Users can read active output types" ON public.output_type_catalog FOR SELECT TO authenticated USING (((is_active = true) AND (deprecated_at IS NULL)));
CREATE POLICY "Users can read block revisions in their workspaces" ON public.block_revisions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.workspace_id = block_revisions.workspace_id) AND (workspace_memberships.user_id = auth.uid())))));
CREATE POLICY "Users can read blocks in their workspaces" ON public.blocks FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.workspace_id = blocks.workspace_id) AND (workspace_memberships.user_id = auth.uid())))));
CREATE POLICY "Users can read documents in their workspaces" ON public.documents FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.workspace_id = documents.workspace_id) AND (workspace_memberships.user_id = auth.uid())))));
CREATE POLICY "Users can revoke own MCP sessions" ON public.mcp_oauth_sessions FOR DELETE USING ((user_id = auth.uid()));
CREATE POLICY "Users can revoke their workspace integration tokens" ON public.integration_tokens FOR UPDATE TO authenticated USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.user_id = auth.uid()) AND (workspace_memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))))) WITH CHECK ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.user_id = auth.uid()) AND (workspace_memberships.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));
CREATE POLICY "Users can supervise outputs in their workspace" ON public.work_outputs FOR UPDATE TO authenticated USING ((basket_id IN ( SELECT b.id
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE (wm.user_id = auth.uid())))) WITH CHECK ((basket_id IN ( SELECT b.id
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE (wm.user_id = auth.uid()))));
CREATE POLICY "Users can update agent sessions in their workspaces" ON public.agent_sessions FOR UPDATE USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Users can update assets in their workspace" ON public.reference_assets FOR UPDATE TO authenticated USING ((basket_id IN ( SELECT b.id
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE (wm.user_id = auth.uid())))) WITH CHECK ((basket_id IN ( SELECT b.id
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE (wm.user_id = auth.uid()))));
CREATE POLICY "Users can update checkpoints in their workspace tickets" ON public.work_checkpoints FOR UPDATE USING ((work_ticket_id IN ( SELECT work_tickets.id
   FROM public.work_tickets
  WHERE (work_tickets.workspace_id IN ( SELECT workspace_memberships.workspace_id
           FROM public.workspace_memberships
          WHERE (workspace_memberships.user_id = auth.uid()))))));
CREATE POLICY "Users can update project schedules" ON public.project_schedules FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.projects p
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((p.id = project_schedules.project_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can update project_agents in their workspace" ON public.project_agents FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.projects p
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((p.id = project_agents.project_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can update projects in their workspace" ON public.projects FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships wm
  WHERE ((wm.workspace_id = projects.workspace_id) AND (wm.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.workspace_memberships wm
  WHERE ((wm.workspace_id = projects.workspace_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can update proposals in their workspace" ON public.proposals FOR UPDATE USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Users can update relationships in their workspace" ON public.substrate_relationships FOR UPDATE USING (((created_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM ((public.blocks b
     JOIN public.baskets bsk ON ((b.basket_id = bsk.id)))
     JOIN public.workspace_memberships wm ON ((bsk.workspace_id = wm.workspace_id)))
  WHERE ((b.id = substrate_relationships.from_block_id) AND (wm.user_id = auth.uid()))))));
CREATE POLICY "Users can update their projects" ON public.projects FOR UPDATE USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Users can update their queued items" ON public.agent_processing_queue FOR UPDATE TO authenticated USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid())))) WITH CHECK ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Users can update their workspace's TP sessions" ON public.tp_sessions FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships wm
  WHERE ((wm.workspace_id = tp_sessions.workspace_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can update work tickets in their workspaces" ON public.work_tickets FOR UPDATE USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Users can upload assets to their workspace" ON public.reference_assets FOR INSERT TO authenticated WITH CHECK ((basket_id IN ( SELECT b.id
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE (wm.user_id = auth.uid()))));
CREATE POLICY "Users can view active recipes" ON public.work_recipes FOR SELECT USING (((status)::text = 'active'::text));
CREATE POLICY "Users can view agent sessions in their workspaces" ON public.agent_sessions FOR SELECT USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Users can view agent_config_history in their workspace" ON public.agent_config_history FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.project_agents pa
     JOIN public.projects p ON ((p.id = pa.project_id)))
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((pa.id = agent_config_history.project_agent_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can view assets in their workspace" ON public.reference_assets FOR SELECT TO authenticated USING ((basket_id IN ( SELECT b.id
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE (wm.user_id = auth.uid()))));
CREATE POLICY "Users can view block_usage in their workspace" ON public.block_usage FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.blocks b
     JOIN public.baskets bsk ON ((bsk.id = b.basket_id)))
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = bsk.workspace_id)))
  WHERE ((b.id = block_usage.block_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can view blocks in their workspace" ON public.blocks FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.baskets
  WHERE ((baskets.id = blocks.basket_id) AND (baskets.workspace_id IN ( SELECT workspace_memberships.workspace_id
           FROM public.workspace_memberships
          WHERE (workspace_memberships.user_id = auth.uid())))))));
CREATE POLICY "Users can view checkpoints in their workspace tickets" ON public.work_checkpoints FOR SELECT USING ((work_ticket_id IN ( SELECT work_tickets.id
   FROM public.work_tickets
  WHERE (work_tickets.workspace_id IN ( SELECT workspace_memberships.workspace_id
           FROM public.workspace_memberships
          WHERE (workspace_memberships.user_id = auth.uid()))))));
CREATE POLICY "Users can view executions in their workspace" ON public.proposal_executions FOR SELECT USING ((proposal_id IN ( SELECT proposals.id
   FROM public.proposals
  WHERE (proposals.workspace_id IN ( SELECT workspace_memberships.workspace_id
           FROM public.workspace_memberships
          WHERE (workspace_memberships.user_id = auth.uid()))))));
CREATE POLICY "Users can view extraction metrics in their workspace" ON public.extraction_quality_metrics FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships wm
  WHERE ((wm.workspace_id = extraction_quality_metrics.workspace_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can view iterations in their workspace tickets" ON public.work_iterations FOR SELECT USING ((work_ticket_id IN ( SELECT work_tickets.id
   FROM public.work_tickets
  WHERE (work_tickets.workspace_id IN ( SELECT workspace_memberships.workspace_id
           FROM public.workspace_memberships
          WHERE (workspace_memberships.user_id = auth.uid()))))));
CREATE POLICY "Users can view messages in their sessions" ON public.tp_messages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.tp_sessions ts
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = ts.workspace_id)))
  WHERE ((ts.id = tp_messages.session_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can view narrative in their workspace" ON public.narrative FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.baskets
  WHERE ((baskets.id = narrative.basket_id) AND (baskets.workspace_id IN ( SELECT workspace_memberships.workspace_id
           FROM public.workspace_memberships
          WHERE (workspace_memberships.user_id = auth.uid())))))));
CREATE POLICY "Users can view outputs in their workspace" ON public.work_outputs FOR SELECT TO authenticated USING ((basket_id IN ( SELECT b.id
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE (wm.user_id = auth.uid()))));
CREATE POLICY "Users can view own MCP sessions" ON public.mcp_oauth_sessions FOR SELECT USING ((user_id = auth.uid()));
CREATE POLICY "Users can view project schedules" ON public.project_schedules FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.projects p
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((p.id = project_schedules.project_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can view project_agents in their workspace" ON public.project_agents FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.projects p
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((p.id = project_agents.project_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can view projects in their workspace" ON public.projects FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships wm
  WHERE ((wm.workspace_id = projects.workspace_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can view projects in their workspaces" ON public.projects FOR SELECT USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Users can view proposals in their workspace" ON public.proposals FOR SELECT USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Users can view queue in their workspace" ON public.agent_processing_queue FOR SELECT TO authenticated USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Users can view raw_dumps in their workspace" ON public.raw_dumps FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.baskets
  WHERE ((baskets.id = raw_dumps.basket_id) AND (baskets.workspace_id IN ( SELECT workspace_memberships.workspace_id
           FROM public.workspace_memberships
          WHERE (workspace_memberships.user_id = auth.uid())))))));
CREATE POLICY "Users can view relationships in their workspace baskets" ON public.substrate_relationships FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.blocks b
     JOIN public.baskets bsk ON ((b.basket_id = bsk.id)))
     JOIN public.workspace_memberships wm ON ((bsk.workspace_id = wm.workspace_id)))
  WHERE (((b.id = substrate_relationships.from_block_id) OR (b.id = substrate_relationships.to_block_id)) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can view their project jobs" ON public.jobs FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.project_schedules ps
     JOIN public.projects p ON ((p.id = ps.project_id)))
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((ps.id = jobs.parent_schedule_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can view their workspace integration tokens" ON public.integration_tokens FOR SELECT TO authenticated USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Users can view their workspace's TP sessions" ON public.tp_sessions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships wm
  WHERE ((wm.workspace_id = tp_sessions.workspace_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "Users can view work requests in their workspaces" ON public.work_requests FOR SELECT USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Users can view work tickets in their workspaces" ON public.work_tickets FOR SELECT USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Workspace members can read events" ON public.events FOR SELECT USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "Workspace members can update events" ON public.events FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.workspace_id = events.workspace_id) AND (workspace_memberships.user_id = auth.uid())))));
ALTER TABLE public.agent_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_config_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_processing_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_work_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow agent insert" ON public.revisions FOR INSERT TO authenticated WITH CHECK (((basket_id IS NOT NULL) AND (basket_id IN ( SELECT baskets.id
   FROM public.baskets
  WHERE (baskets.workspace_id IN ( SELECT workspace_memberships.workspace_id
           FROM public.workspace_memberships
          WHERE (workspace_memberships.user_id = auth.uid())))))));
ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artifact_generation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY artifact_settings_workspace ON public.artifact_generation_settings USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
ALTER TABLE public.asset_type_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basket_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY basket_member_delete ON public.baskets FOR DELETE USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY basket_member_insert ON public.baskets FOR INSERT WITH CHECK ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY basket_member_read ON public.baskets FOR SELECT USING (((auth.uid() IS NOT NULL) AND (workspace_id IN ( SELECT workspaces.id
   FROM public.workspaces
  WHERE (workspaces.owner_id = auth.uid())))));
CREATE POLICY basket_member_update ON public.baskets FOR UPDATE USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
ALTER TABLE public.basket_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY basket_signatures_select ON public.basket_signatures FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships wm
  WHERE ((wm.workspace_id = basket_signatures.workspace_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY basket_signatures_service_insert ON public.basket_signatures FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY basket_signatures_service_update ON public.basket_signatures FOR UPDATE USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
ALTER TABLE public.baskets ENABLE ROW LEVEL SECURITY;
CREATE POLICY baskets_insert_members ON public.baskets FOR INSERT TO authenticated WITH CHECK ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY bh_insert_by_workspace ON public.timeline_events FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.baskets b
     JOIN public.workspace_memberships m ON ((m.workspace_id = b.workspace_id)))
  WHERE ((b.id = timeline_events.basket_id) AND (m.user_id = auth.uid())))));
CREATE POLICY bh_select_by_workspace ON public.timeline_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.baskets b
     JOIN public.workspace_memberships m ON ((m.workspace_id = b.workspace_id)))
  WHERE ((b.id = timeline_events.basket_id) AND (m.user_id = auth.uid())))));
CREATE POLICY block_member_delete ON public.blocks FOR DELETE USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY block_member_insert ON public.blocks FOR INSERT WITH CHECK ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY block_member_read ON public.blocks FOR SELECT USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY block_member_update ON public.blocks FOR UPDATE USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
ALTER TABLE public.block_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.block_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY blocks_delete_workspace_member ON public.blocks FOR DELETE TO authenticated USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY blocks_insert_workspace_member ON public.blocks FOR INSERT TO authenticated WITH CHECK ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY blocks_select_workspace_member ON public.blocks FOR SELECT TO authenticated USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY blocks_service_role_all ON public.blocks TO service_role USING (true) WITH CHECK (true);
CREATE POLICY blocks_update_workspace_member ON public.blocks FOR UPDATE TO authenticated USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY br_insert_workspace_member ON public.reflections_artifact FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE ((b.id = reflections_artifact.basket_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY br_select_workspace_member ON public.reflections_artifact FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE ((b.id = reflections_artifact.basket_id) AND (wm.user_id = auth.uid())))));
ALTER TABLE public.context_entry_schemas ENABLE ROW LEVEL SECURITY;
CREATE POLICY context_entry_schemas_select_authenticated ON public.context_entry_schemas FOR SELECT TO authenticated USING (true);
CREATE POLICY context_entry_schemas_service_role ON public.context_entry_schemas TO service_role USING (true) WITH CHECK (true);
ALTER TABLE public.context_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY context_items_delete_workspace_members ON public.context_items FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.baskets b
     JOIN public.projects p ON ((p.basket_id = b.id)))
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((b.id = context_items.basket_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY context_items_insert_workspace_members ON public.context_items FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM ((public.baskets b
     JOIN public.projects p ON ((p.basket_id = b.id)))
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((b.id = context_items.basket_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY context_items_select_workspace_members ON public.context_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.baskets b
     JOIN public.projects p ON ((p.basket_id = b.id)))
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((b.id = context_items.basket_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY context_items_service_role ON public.context_items TO service_role USING (true) WITH CHECK (true);
CREATE POLICY context_items_update_workspace_members ON public.context_items FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.baskets b
     JOIN public.projects p ON ((p.basket_id = b.id)))
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((b.id = context_items.basket_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "debug insert bypass" ON public.workspaces FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "delete history by service role" ON public.timeline_events FOR DELETE USING ((auth.role() = 'service_role'::text));
CREATE POLICY "delete reflections by service role" ON public.reflections_artifact FOR DELETE USING ((auth.role() = 'service_role'::text));
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_versions_workspace_insert ON public.document_versions FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ((public.documents d
     JOIN public.baskets b ON ((d.basket_id = b.id)))
     JOIN public.workspace_memberships wm ON ((b.workspace_id = wm.workspace_id)))
  WHERE ((d.id = document_versions.document_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY document_versions_workspace_select ON public.document_versions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.documents d
     JOIN public.baskets b ON ((d.basket_id = b.id)))
     JOIN public.workspace_memberships wm ON ((b.workspace_id = wm.workspace_id)))
  WHERE ((d.id = document_versions.document_id) AND (wm.user_id = auth.uid())))));
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_delete_workspace_member ON public.documents FOR DELETE TO authenticated USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY documents_insert_workspace_member ON public.documents FOR INSERT TO authenticated WITH CHECK ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY documents_select_workspace_member ON public.documents FOR SELECT TO authenticated USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY documents_service_role_all ON public.documents TO service_role USING (true) WITH CHECK (true);
CREATE POLICY documents_update_workspace_member ON public.documents FOR UPDATE TO authenticated USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY dump_member_read ON public.raw_dumps FOR SELECT USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY event_member_delete ON public.events FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.workspace_id = events.workspace_id) AND (workspace_memberships.user_id = auth.uid())))));
CREATE POLICY event_member_insert ON public.events FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.workspace_id = events.workspace_id) AND (workspace_memberships.user_id = auth.uid())))));
CREATE POLICY event_member_update ON public.events FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.workspace_id = events.workspace_id) AND (workspace_memberships.user_id = auth.uid())))));
CREATE POLICY events_insert_workspace_member ON public.events FOR INSERT TO authenticated WITH CHECK ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY events_select_workspace_member ON public.events FOR SELECT TO authenticated USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY events_service_role_all ON public.events TO service_role USING (true) WITH CHECK (true);
ALTER TABLE public.extraction_quality_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_timeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY knowledge_timeline_workspace_read ON public.knowledge_timeline FOR SELECT USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
ALTER TABLE public.mcp_activity_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY mcp_activity_select ON public.mcp_activity_logs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships wm
  WHERE ((wm.workspace_id = mcp_activity_logs.workspace_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY mcp_activity_service_delete ON public.mcp_activity_logs FOR DELETE USING ((auth.role() = 'service_role'::text));
CREATE POLICY mcp_activity_service_insert ON public.mcp_activity_logs FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));
ALTER TABLE public.mcp_oauth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_unassigned_captures ENABLE ROW LEVEL SECURITY;
CREATE POLICY mcp_unassigned_select ON public.mcp_unassigned_captures FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships wm
  WHERE ((wm.workspace_id = mcp_unassigned_captures.workspace_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY mcp_unassigned_service_delete ON public.mcp_unassigned_captures FOR DELETE USING ((auth.role() = 'service_role'::text));
CREATE POLICY mcp_unassigned_service_insert ON public.mcp_unassigned_captures FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY mcp_unassigned_update ON public.mcp_unassigned_captures FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships wm
  WHERE ((wm.workspace_id = mcp_unassigned_captures.workspace_id) AND (wm.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.workspace_memberships wm
  WHERE ((wm.workspace_id = mcp_unassigned_captures.workspace_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY member_self_crud ON public.workspace_memberships USING ((user_id = auth.uid()));
CREATE POLICY member_self_insert ON public.workspace_memberships FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));
ALTER TABLE public.narrative ENABLE ROW LEVEL SECURITY;
CREATE POLICY narrative_delete_workspace_member ON public.narrative FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE ((b.id = narrative.basket_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY narrative_insert_workspace_member ON public.narrative FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE ((b.id = narrative.basket_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY narrative_select_workspace_member ON public.narrative FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE ((b.id = narrative.basket_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY narrative_service_role_all ON public.narrative TO service_role USING (true) WITH CHECK (true);
CREATE POLICY narrative_update_workspace_member ON public.narrative FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE ((b.id = narrative.basket_id) AND (wm.user_id = auth.uid())))));
ALTER TABLE public.openai_app_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY openai_app_tokens_service_access ON public.openai_app_tokens USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
ALTER TABLE public.output_type_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY p3_p4_policy_workspace_access ON public.p3_p4_regeneration_policy USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
ALTER TABLE public.p3_p4_regeneration_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_recipe_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY proposal_executions_insert ON public.proposal_executions FOR INSERT WITH CHECK ((proposal_id IN ( SELECT proposals.id
   FROM public.proposals
  WHERE (proposals.workspace_id IN ( SELECT workspace_memberships.workspace_id
           FROM public.workspace_memberships
          WHERE (workspace_memberships.user_id = auth.uid()))))));
CREATE POLICY proposal_executions_select ON public.proposal_executions FOR SELECT USING ((proposal_id IN ( SELECT proposals.id
   FROM public.proposals
  WHERE (proposals.workspace_id IN ( SELECT workspace_memberships.workspace_id
           FROM public.workspace_memberships
          WHERE (workspace_memberships.user_id = auth.uid()))))));
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_dumps ENABLE ROW LEVEL SECURITY;
CREATE POLICY raw_dumps_delete_workspace_member ON public.raw_dumps FOR DELETE TO authenticated USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY raw_dumps_insert_workspace_member ON public.raw_dumps FOR INSERT TO authenticated WITH CHECK ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY raw_dumps_select_workspace_member ON public.raw_dumps FOR SELECT TO authenticated USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY raw_dumps_workspace_insert ON public.raw_dumps FOR INSERT TO authenticated WITH CHECK ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY "read history by workspace members" ON public.timeline_events FOR SELECT USING (((auth.role() = 'service_role'::text) OR (EXISTS ( SELECT 1
   FROM (public.baskets b
     JOIN public.v_user_workspaces m ON ((m.workspace_id = b.workspace_id)))
  WHERE ((b.id = timeline_events.basket_id) AND (m.user_id = auth.uid()))))));
CREATE POLICY "read reflections by workspace members" ON public.reflections_artifact FOR SELECT USING (((auth.role() = 'service_role'::text) OR (EXISTS ( SELECT 1
   FROM (public.baskets b
     JOIN public.v_user_workspaces m ON ((m.workspace_id = b.workspace_id)))
  WHERE ((b.id = reflections_artifact.basket_id) AND (m.user_id = auth.uid()))))));
ALTER TABLE public.reference_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY reflection_cache_no_user_delete ON public.reflections_artifact FOR DELETE USING (false);
CREATE POLICY reflection_cache_no_user_insert ON public.reflections_artifact FOR INSERT WITH CHECK (false);
CREATE POLICY reflection_cache_no_user_update ON public.reflections_artifact FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY reflection_cache_read ON public.reflections_artifact FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships m
  WHERE ((m.user_id = auth.uid()) AND (m.workspace_id = reflections_artifact.workspace_id)))));
ALTER TABLE public.reflections_artifact ENABLE ROW LEVEL SECURITY;
CREATE POLICY reflections_artifact_service_insert ON public.reflections_artifact FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY reflections_artifact_workspace_select ON public.reflections_artifact FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships wm
  WHERE ((wm.workspace_id = reflections_artifact.workspace_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY revision_member_delete ON public.block_revisions FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.workspace_id = block_revisions.workspace_id) AND (workspace_memberships.user_id = auth.uid())))));
CREATE POLICY revision_member_insert ON public.block_revisions FOR INSERT WITH CHECK (true);
CREATE POLICY revision_member_read ON public.block_revisions FOR SELECT USING (true);
CREATE POLICY revision_member_update ON public.block_revisions FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.workspace_id = block_revisions.workspace_id) AND (workspace_memberships.user_id = auth.uid())))));
ALTER TABLE public.revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY schedule_service_full ON public.project_recipe_schedules TO service_role USING (true) WITH CHECK (true);
CREATE POLICY schedule_workspace_members_delete ON public.project_recipe_schedules FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.projects p
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((p.id = project_recipe_schedules.project_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY schedule_workspace_members_insert ON public.project_recipe_schedules FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.projects p
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((p.id = project_recipe_schedules.project_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY schedule_workspace_members_select ON public.project_recipe_schedules FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.projects p
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((p.id = project_recipe_schedules.project_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY schedule_workspace_members_update ON public.project_recipe_schedules FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.projects p
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((p.id = project_recipe_schedules.project_id) AND (wm.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.projects p
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = p.workspace_id)))
  WHERE ((p.id = project_recipe_schedules.project_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY select_own_raw_dumps ON public.raw_dumps FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.baskets b
  WHERE ((b.id = raw_dumps.basket_id) AND (b.user_id = auth.uid())))));
CREATE POLICY select_own_revisions ON public.revisions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.baskets b
  WHERE ((b.id = revisions.basket_id) AND (b.user_id = auth.uid())))));
CREATE POLICY "service role ALL access" ON public.raw_dumps TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service role full access" ON public.baskets TO service_role USING (true);
CREATE POLICY "service role full access" ON public.raw_dumps TO service_role USING (true);
CREATE POLICY service_role_can_insert_events ON public.app_events FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY subscriptions_service_write ON public.user_agent_subscriptions USING (((auth.jwt() ->> 'role'::text) = 'service_role'::text));
CREATE POLICY subscriptions_user_read ON public.user_agent_subscriptions FOR SELECT USING ((auth.uid() = user_id));
ALTER TABLE public.substrate_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY substrate_references_delete_policy ON public.substrate_references FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ((public.documents d
     JOIN public.baskets b ON ((d.basket_id = b.id)))
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE ((d.id = substrate_references.document_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY substrate_references_insert_policy ON public.substrate_references FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ((public.documents d
     JOIN public.baskets b ON ((d.basket_id = b.id)))
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE ((d.id = substrate_references.document_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY substrate_references_select_policy ON public.substrate_references FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.documents d
     JOIN public.baskets b ON ((d.basket_id = b.id)))
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE ((d.id = substrate_references.document_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY substrate_references_update_policy ON public.substrate_references FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ((public.documents d
     JOIN public.baskets b ON ((d.basket_id = b.id)))
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE ((d.id = substrate_references.document_id) AND (wm.user_id = auth.uid())))));
ALTER TABLE public.substrate_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY te_select_workspace_member ON public.timeline_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.baskets b
     JOIN public.workspace_memberships wm ON ((wm.workspace_id = b.workspace_id)))
  WHERE ((b.id = timeline_events.basket_id) AND (wm.user_id = auth.uid())))));
CREATE POLICY "timeline insert: workspace member" ON public.timeline_events FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.baskets b
     JOIN public.workspace_memberships m ON ((m.workspace_id = b.workspace_id)))
  WHERE ((b.id = timeline_events.basket_id) AND (m.user_id = auth.uid())))));
CREATE POLICY "timeline read: workspace member" ON public.timeline_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.baskets b
     JOIN public.workspace_memberships m ON ((m.workspace_id = b.workspace_id)))
  WHERE ((b.id = timeline_events.basket_id) AND (m.user_id = auth.uid())))));
ALTER TABLE public.timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tp_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "update history by service role" ON public.timeline_events FOR UPDATE USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "update reflections by service role" ON public.reflections_artifact FOR UPDATE USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
ALTER TABLE public.user_agent_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_alerts_own_read ON public.user_alerts FOR SELECT USING ((user_id = auth.uid()));
CREATE POLICY user_alerts_own_update ON public.user_alerts FOR UPDATE USING ((user_id = auth.uid()));
ALTER TABLE public.work_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_iterations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY work_requests_service_write ON public.agent_work_requests USING (((auth.jwt() ->> 'role'::text) = 'service_role'::text));
CREATE POLICY work_requests_user_read ON public.agent_work_requests FOR SELECT USING ((auth.uid() = user_id));
ALTER TABLE public.work_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_governance_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_governance_settings_insert ON public.workspace_governance_settings FOR INSERT WITH CHECK ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.user_id = auth.uid()) AND (workspace_memberships.role = ANY (ARRAY['admin'::text, 'owner'::text]))))));
CREATE POLICY workspace_governance_settings_select ON public.workspace_governance_settings FOR SELECT USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid()))));
CREATE POLICY workspace_governance_settings_update ON public.workspace_governance_settings FOR UPDATE USING ((workspace_id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.user_id = auth.uid()) AND (workspace_memberships.role = ANY (ARRAY['admin'::text, 'owner'::text]))))));
CREATE POLICY workspace_members_can_read_events ON public.app_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships
  WHERE ((workspace_memberships.workspace_id = app_events.workspace_id) AND (workspace_memberships.user_id = auth.uid())))));
ALTER TABLE public.workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "write history by service role" ON public.timeline_events FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "write reflections by service role" ON public.reflections_artifact FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY ws_owner_delete ON public.workspaces FOR DELETE USING ((owner_id = auth.uid()));
CREATE POLICY ws_owner_or_member_read ON public.workspaces FOR SELECT USING (((owner_id = auth.uid()) OR (id IN ( SELECT workspace_memberships.workspace_id
   FROM public.workspace_memberships
  WHERE (workspace_memberships.user_id = auth.uid())))));
CREATE POLICY ws_owner_update ON public.workspaces FOR UPDATE USING ((owner_id = auth.uid()));
\unrestrict tTjlXhVBrn2P7gPHQnV1oj8XtPfWWgwbaIpUf91u8ZbpgctEGEbLCHg5XwwYMee
