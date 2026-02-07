-- 0006_ops_harden_autoapprove.sql
-- Enforces risk_level checks in auto-approval logic

CREATE OR REPLACE FUNCTION ops_is_auto_approvable(p_template jsonb)
returns boolean language plpgsql as $$
declare
  v_policy jsonb;
  v_enabled boolean;
  v_allowed jsonb;
  v_max_risk text;
  v_current_risk text;
  v_step_kinds text[];
  v_kind text;
begin
  select value into v_policy from ops_policy where key = 'auto_approve';

  if v_policy is null then
    return false;
  end if;

  v_enabled := coalesce((v_policy->>'enabled')::boolean, false);
  if v_enabled is false then
    return false;
  end if;

  -- 1. Check Risk Level
  v_max_risk := v_policy->>'max_risk_level';
  v_current_risk := p_template->>'risk_level';
  
  if v_max_risk is not null then
    -- Simple risk order: low < medium < high
    if v_max_risk = 'low' and v_current_risk != 'low' then
      return false;
    end if;
    if v_max_risk = 'medium' and v_current_risk = 'high' then
      return false;
    end if;
  end if;

  -- 2. Check Step Kinds
  v_allowed := v_policy->'allowed_step_kinds';
  if v_allowed is not null then
    v_step_kinds := ops_extract_step_kinds(p_template);
    if v_step_kinds is null then return false; end if;
    foreach v_kind in array v_step_kinds loop
      if not (v_allowed ? v_kind) then
        return false;
      end if;
    end loop;
  end if;

  return true;
end;
$$;
