"""
Real-time Task Updates Streaming for Work Tickets

Provides SSE (Server-Sent Events) endpoint for streaming agent task progress
to the frontend. Compatible with TodoWrite tool from Claude Agent SDK.
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from typing import AsyncGenerator, Optional
import asyncio
import json
from datetime import datetime
from uuid import UUID

from app.utils.jwt import verify_jwt
from app.utils.supabase_client import supabase_admin_client as supabase
import logging

router = APIRouter(prefix="/work/tickets", tags=["work-streaming"])
logger = logging.getLogger(__name__)


# In-memory store for task updates (replace with Redis for multi-instance)
TASK_UPDATES: dict[str, list[dict]] = {}


def emit_task_update(ticket_id: str, update: dict):
    """
    Emit a task update to be streamed to subscribed clients.

    Called by agent execution code to broadcast progress updates.

    Args:
        ticket_id: Work ticket UUID
        update: Update data (status, step, progress, etc.)
    """
    if ticket_id not in TASK_UPDATES:
        TASK_UPDATES[ticket_id] = []

    update["timestamp"] = datetime.utcnow().isoformat()
    TASK_UPDATES[ticket_id].append(update)

    logger.info(f"[Task Update] {ticket_id}: {update.get('current_step', 'N/A')}")


async def task_update_generator(
    ticket_id: str,
    timeout: int = 600  # 10 minutes max
) -> AsyncGenerator[str, None]:
    """
    Generate SSE stream for task updates.

    Yields updates as they arrive until ticket is completed or timeout.
    """
    start_time = asyncio.get_event_loop().time()
    last_sent_index = 0

    # Send initial connection event
    yield f"data: {json.dumps({'type': 'connected', 'ticket_id': ticket_id})}\n\n"

    while asyncio.get_event_loop().time() - start_time < timeout:
        # Check for new updates
        if ticket_id in TASK_UPDATES:
            updates = TASK_UPDATES[ticket_id]

            # Send any new updates
            while last_sent_index < len(updates):
                update = updates[last_sent_index]
                yield f"data: {json.dumps(update)}\n\n"
                last_sent_index += 1

                # Check if task is complete
                if update.get("status") in ["completed", "failed"]:
                    # Clean up updates after sending completion
                    TASK_UPDATES.pop(ticket_id, None)
                    return

        # Check ticket status in database
        try:
            result = supabase.table("work_tickets").select("status").eq("id", ticket_id).maybe_single().execute()
            if result.data and result.data["status"] in ["completed", "failed"]:
                yield f"data: {json.dumps({'type': 'completed', 'status': result.data['status']})}\n\n"
                TASK_UPDATES.pop(ticket_id, None)
                return
        except Exception as e:
            logger.error(f"Error checking ticket status: {e}")

        await asyncio.sleep(0.5)

    # Timeout
    yield f"data: {json.dumps({'type': 'timeout'})}\n\n"
    TASK_UPDATES.pop(ticket_id, None)


@router.get("/{ticket_id}/stream")
async def stream_task_updates(
    ticket_id: str,
    user: dict = Depends(verify_jwt)
):
    """
    Stream real-time task updates for a work ticket via SSE.

    Frontend subscribes to this endpoint to get live progress updates
    from the agent execution (TodoWrite tool outputs, intermediate steps, etc.).

    Usage (Frontend):
        const eventSource = new EventSource('/api/work/tickets/{id}/stream');
        eventSource.onmessage = (event) => {
            const update = JSON.parse(event.data);
            console.log('Task update:', update);
        };

    Args:
        ticket_id: Work ticket UUID
        user: Authenticated user from JWT

    Returns:
        SSE stream of task updates
    """
    user_id = user.get("sub") or user.get("user_id")

    # Verify ticket exists and user has access
    try:
        ticket_result = supabase.table("work_tickets").select(
            "id, workspace_id, basket_id"
        ).eq("id", ticket_id).maybe_single().execute()

        if not ticket_result.data:
            raise HTTPException(status_code=404, detail="Work ticket not found")

        # TODO: Add workspace permission check

        logger.info(f"[SSE Stream] Client connected: ticket={ticket_id}, user={user_id}")

        return StreamingResponse(
            task_update_generator(ticket_id),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",  # Disable nginx buffering
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[SSE Stream] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
