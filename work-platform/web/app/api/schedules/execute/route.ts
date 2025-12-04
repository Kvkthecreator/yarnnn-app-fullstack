/**
 * API Route: /api/schedules/execute
 *
 * Schedule executor endpoint - called by cron worker to process due schedules.
 * Creates work tickets for schedules where next_run_at <= now().
 *
 * Security: Requires CRON_SECRET header for authentication.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/clients";

const CRON_SECRET = process.env.CRON_SECRET;

interface ScheduleWithRecipe {
  id: string;
  project_id: string;
  basket_id: string;
  recipe_id: string;
  frequency: string;
  day_of_week: number;
  time_of_day: string;
  recipe_parameters: Record<string, unknown>;
  enabled: boolean;
  next_run_at: string;
  run_count: number;
  work_recipes: {
    id: string;
    slug: string;
    name: string;
    agent_type: string;
    context_requirements: Record<string, unknown>;
  };
}

// POST /api/schedules/execute - Process all due schedules
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get("authorization");
    if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json(
        { detail: "Unauthorized" },
        { status: 401 }
      );
    }

    const supabase = createServiceRoleClient();
    const now = new Date().toISOString();

    // Find all due schedules
    const { data: dueSchedules, error: fetchError } = await supabase
      .from("project_schedules")
      .select(`
        id,
        project_id,
        basket_id,
        recipe_id,
        frequency,
        day_of_week,
        time_of_day,
        recipe_parameters,
        enabled,
        next_run_at,
        run_count,
        work_recipes (
          id,
          slug,
          name,
          agent_type,
          context_requirements
        )
      `)
      .eq("enabled", true)
      .lte("next_run_at", now)
      .order("next_run_at");

    if (fetchError) {
      console.error("[SCHEDULE EXECUTOR] Failed to fetch schedules:", fetchError);
      return NextResponse.json(
        { detail: "Failed to fetch schedules" },
        { status: 500 }
      );
    }

    if (!dueSchedules || dueSchedules.length === 0) {
      return NextResponse.json({
        message: "No schedules due",
        processed: 0,
      });
    }

    console.log(`[SCHEDULE EXECUTOR] Found ${dueSchedules.length} due schedules`);

    const results: Array<{
      schedule_id: string;
      ticket_id?: string;
      status: "success" | "error";
      error?: string;
    }> = [];

    // Process each due schedule
    for (const schedule of dueSchedules as ScheduleWithRecipe[]) {
      try {
        const recipe = schedule.work_recipes;
        if (!recipe) {
          results.push({
            schedule_id: schedule.id,
            status: "error",
            error: "Recipe not found",
          });
          continue;
        }

        // Get workspace_id from basket
        const { data: basket } = await supabase
          .from("baskets")
          .select("workspace_id")
          .eq("id", schedule.basket_id)
          .single();

        if (!basket) {
          results.push({
            schedule_id: schedule.id,
            status: "error",
            error: "Basket not found",
          });
          continue;
        }

        // Check for existing continuous ticket for this schedule
        const { data: existingTicket } = await supabase
          .from("work_tickets")
          .select("id, cycle_number")
          .eq("schedule_id", schedule.id)
          .eq("mode", "continuous")
          .order("cycle_number", { ascending: false })
          .limit(1)
          .maybeSingle();

        const cycleNumber = existingTicket ? existingTicket.cycle_number + 1 : 1;

        // Create work ticket
        const ticketData = {
          basket_id: schedule.basket_id,
          workspace_id: basket.workspace_id,
          agent_type: recipe.slug,
          status: "pending",
          priority: 5,
          source: "schedule",
          mode: "continuous",
          schedule_id: schedule.id,
          cycle_number: cycleNumber,
          metadata: {
            recipe_slug: recipe.slug,
            recipe_name: recipe.name,
            parameters: schedule.recipe_parameters,
            context_required: recipe.context_requirements,
            triggered_by: "schedule",
            schedule_id: schedule.id,
            triggered_at: now,
            cycle_number: cycleNumber,
          },
        };

        const { data: ticket, error: ticketError } = await supabase
          .from("work_tickets")
          .insert(ticketData)
          .select("id")
          .single();

        if (ticketError) {
          console.error(`[SCHEDULE EXECUTOR] Failed to create ticket for schedule ${schedule.id}:`, ticketError);
          results.push({
            schedule_id: schedule.id,
            status: "error",
            error: ticketError.message,
          });

          // Update schedule with failure
          await supabase
            .from("project_schedules")
            .update({
              last_run_at: now,
              last_run_status: "failed",
            })
            .eq("id", schedule.id);

          continue;
        }

        // Update schedule with success
        const { error: updateError } = await supabase
          .from("project_schedules")
          .update({
            last_run_at: now,
            last_run_status: "success",
            last_run_ticket_id: ticket.id,
            run_count: schedule.run_count + 1,
          })
          .eq("id", schedule.id);

        if (updateError) {
          console.error(`[SCHEDULE EXECUTOR] Failed to update schedule ${schedule.id}:`, updateError);
        }

        console.log(`[SCHEDULE EXECUTOR] Created ticket ${ticket.id} for schedule ${schedule.id} (cycle ${cycleNumber})`);

        results.push({
          schedule_id: schedule.id,
          ticket_id: ticket.id,
          status: "success",
        });

      } catch (err) {
        console.error(`[SCHEDULE EXECUTOR] Error processing schedule ${schedule.id}:`, err);
        results.push({
          schedule_id: schedule.id,
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const successCount = results.filter(r => r.status === "success").length;
    const errorCount = results.filter(r => r.status === "error").length;

    return NextResponse.json({
      message: `Processed ${dueSchedules.length} schedules`,
      processed: dueSchedules.length,
      success: successCount,
      errors: errorCount,
      results,
    });

  } catch (error) {
    console.error("[SCHEDULE EXECUTOR] Error:", error);
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

// GET /api/schedules/execute - Health check / status
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    // Count due schedules
    const { count: dueCount } = await supabase
      .from("project_schedules")
      .select("*", { count: "exact", head: true })
      .eq("enabled", true)
      .lte("next_run_at", new Date().toISOString());

    // Count total active schedules
    const { count: totalCount } = await supabase
      .from("project_schedules")
      .select("*", { count: "exact", head: true })
      .eq("enabled", true);

    return NextResponse.json({
      status: "healthy",
      due_schedules: dueCount || 0,
      total_active_schedules: totalCount || 0,
      checked_at: new Date().toISOString(),
    });

  } catch (error) {
    return NextResponse.json(
      { status: "error", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
