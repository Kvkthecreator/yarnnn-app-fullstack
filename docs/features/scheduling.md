# Scheduling Feature Architecture

> **Last Updated:** December 2024
> **Status:** Phase 2 - Schedules Management UI
> **Decision:** Render Worker with Job Queue Abstraction

---

## Table of Contents

1. [Overview](#overview)
2. [Decision History](#decision-history)
3. [Architecture](#architecture)
4. [Domain vs Infrastructure Separation](#domain-vs-infrastructure-separation)
5. [Current Implementation](#current-implementation)
6. [Future Evolution Paths](#future-evolution-paths)
7. [Related Features](#related-features)

---

## Overview

The scheduling system enables:
- **User-defined schedules**: Recurring recipe execution (weekly, biweekly, monthly)
- **Stale anchor refresh**: Automatic context refresh based on TTL policies
- **Extensible job queue**: Foundation for email notifications, LLM batching, etc.

### Key Design Principles

1. **Infrastructure Agnostic**: Domain logic is separate from execution infrastructure
2. **Provider Flexibility**: Can swap between Supabase pg_cron, Render cron, GitHub Actions, etc.
3. **Single Source of Truth**: All jobs stored in Supabase `jobs` table
4. **Graceful Degradation**: System works without scheduler; jobs just wait longer

---

## Decision History

### Context (December 2024)

We needed to implement scheduled work recipe execution. The key considerations were:

| Factor | Constraint |
|--------|------------|
| **Supabase Plan** | Free tier (no pg_cron available) |
| **Budget** | Minimize additional monthly costs |
| **Complexity** | Avoid new infrastructure if possible |
| **Future Needs** | Email notifications, LLM batch API integration |

### Options Evaluated

| Option | Cost | Reliability | Complexity | Flexibility |
|--------|------|-------------|------------|-------------|
| **Supabase pg_cron** | $25/mo (Pro plan) | Highest | Lowest | Medium |
| **Render Cron Job** | $7/mo | High | Low | Medium |
| **GitHub Actions** | $0 | Medium | Low | Low |
| **Vercel Cron** | $0 (Pro) | High | Medium | Low |
| **Embed in Render Worker** | $0 | High | Low | High |

### Decision: Render Worker with Job Queue Abstraction

**Chosen approach:** Embed job processing in the existing `canonical_queue_processor` on Render.

**Rationale:**
1. **$0 additional cost** - Uses existing infrastructure
2. **Already running** - No cold start issues
3. **Job queue abstraction** - Enables future provider swaps without code changes
4. **Handles multiple job types** - Scheduling, email, LLM batch all use same pattern

### Why Not Other Options?

- **pg_cron**: Requires Supabase Pro ($25/mo) - good option if we upgrade later
- **Render Cron**: $7/mo for a separate service that just triggers jobs
- **GitHub Actions**: Imprecise timing, not suitable for < 1 hour intervals
- **Vercel Cron**: 10s execution limit, would just trigger backend anyway

---

## Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                         APPLICATION LAYER                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │ Recipe Config   │  │ Context Page    │  │ Work Tickets    │     │
│  │ (Schedule UI)   │  │ (Stale badges)  │  │ (Results)       │     │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘     │
│           │                    │                    │               │
│           ▼                    ▼                    ▼               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Schedule API Endpoints                    │   │
│  │         POST/GET/PATCH/DELETE /api/projects/[id]/schedules  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          DOMAIN LAYER                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │ project_        │  │ jobs            │  │ Job Handlers    │     │
│  │ schedules       │  │ (queue)         │  │ (Python)        │     │
│  │ (preferences)   │  │                 │  │                 │     │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘     │
│           │                    │                    │               │
│  User preferences      Job definitions       Domain logic          │
│  (frequency, day,      (what to do,          (how to execute       │
│   time, params)         when, retry)          each job type)       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       INFRASTRUCTURE LAYER                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Job Executor Interface                    │   │
│  │                                                              │   │
│  │  claim_jobs() → list[Job]                                   │   │
│  │  complete_job(job_id, result)                               │   │
│  │  fail_job(job_id, error)                                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│              ┌───────────────┼───────────────┐                     │
│              ▼               ▼               ▼                     │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐          │
│  │ Render Worker │  │ pg_cron       │  │ GitHub        │          │
│  │ (current)     │  │ (future)      │  │ Actions       │          │
│  └───────────────┘  └───────────────┘  └───────────────┘          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. USER CREATES SCHEDULE
   RecipeConfigureClient → POST /api/projects/[id]/schedules
                         → INSERT project_schedules
                         → Trigger calculates next_run_at

2. WORKER CHECKS FOR DUE SCHEDULES (every 15 min)
   JobWorker._check_schedules()
   → SELECT from project_schedules WHERE next_run_at <= NOW()
   → INSERT into jobs (job_type='scheduled_work')
   → UPDATE project_schedules.next_run_at

3. WORKER PROCESSES JOBS
   JobWorker._process_jobs()
   → SELECT from jobs WHERE status='pending' AND scheduled_for <= NOW()
   → JobHandler.handle(job)
   → UPDATE jobs.status = 'completed'

4. JOB CREATES WORK TICKET
   handle_scheduled_work(payload)
   → INSERT work_tickets
   → canonical_queue_processor picks it up
   → Agent executes recipe
```

---

## Domain vs Infrastructure Separation

### Domain Layer (Infrastructure Agnostic)

These components contain business logic and don't know about execution infrastructure:

| Component | Location | Purpose |
|-----------|----------|---------|
| `project_schedules` table | `supabase/migrations/` | User schedule preferences |
| `jobs` table | `supabase/migrations/` | Job queue (what needs to happen) |
| `calculate_next_run_at()` | SQL function | Schedule timing logic |
| Job Handlers | `substrate-api/.../job_handlers.py` | What each job type does |
| Schedule API | `web/app/api/projects/[id]/schedules/` | CRUD for user schedules |

### Infrastructure Layer (Swappable)

These components handle HOW jobs get processed:

| Component | Location | Purpose |
|-----------|----------|---------|
| `JobExecutor` interface | `substrate-api/.../job_executor.py` | Abstract job claiming/completion |
| `SupabaseJobExecutor` | `substrate-api/.../job_executor.py` | Polls Supabase jobs table |
| `JobWorker` | `substrate-api/.../job_worker.py` | Background loop in Render |
| Worker integration | `substrate-api/.../agent_server.py` | Startup/shutdown |

### Separation Rules

1. **Job handlers never know who called them** - They receive payload, return result
2. **Executor interface is stable** - `claim_jobs()`, `complete_job()`, `fail_job()`
3. **Job types are extensible** - Add new handler, register in registry
4. **Infrastructure swap = new executor** - Domain code unchanged

---

## Current Implementation

### Database Schema

```sql
-- User preferences (what schedules exist)
CREATE TABLE project_schedules (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  recipe_id UUID REFERENCES work_recipes(id),
  basket_id UUID REFERENCES baskets(id),
  frequency TEXT,  -- 'weekly', 'biweekly', 'monthly'
  day_of_week INTEGER,
  time_of_day TIME,
  recipe_parameters JSONB,
  enabled BOOLEAN,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  ...
);

-- Job queue (what needs to happen)
CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  job_type TEXT,  -- 'scheduled_work', 'stale_refresh', 'email', 'llm_batch'
  payload JSONB,
  scheduled_for TIMESTAMPTZ,
  status TEXT,  -- 'pending', 'claimed', 'running', 'completed', 'failed'
  priority INTEGER,
  attempts INTEGER,
  max_attempts INTEGER,
  ...
);
```

### Job Types

| Type | Trigger | Handler | Output |
|------|---------|---------|--------|
| `scheduled_work` | project_schedules.next_run_at | Execute recipe | work_ticket created |
| `stale_refresh` | block.updated_at + TTL expired | Execute recipe | Context block refreshed |
| `email_notification` | (future) work output approved | Send email | Email sent |
| `llm_batch` | (future) batch API callback | Process results | Outputs updated |

### File Structure

```
substrate-api/api/src/
├── services/
│   ├── job_executor.py      # Executor interface + Supabase impl
│   ├── job_handlers.py      # Handler registry + implementations
│   ├── job_worker.py        # Background worker loop
│   └── canonical_queue_processor.py  # Existing work processor
└── app/
    └── agent_server.py      # Integrates job worker on startup

work-platform/web/
├── app/
│   ├── api/projects/[id]/schedules/
│   │   ├── route.ts             # GET, POST schedules
│   │   └── [scheduleId]/route.ts # GET, PATCH, DELETE schedule
│   └── projects/[id]/
│       ├── schedules/
│       │   ├── page.tsx             # Schedules list page (server)
│       │   └── SchedulesClient.tsx  # List + state management (client)
│       └── work-tickets/new/configure/
│           └── RecipeConfigureClient.tsx  # Schedule UI (inline create)
└── components/
    ├── projects/ProjectNavigation.tsx  # Tab navigation (includes Schedules)
    └── schedules/
        ├── ScheduleCard.tsx         # List item component
        ├── ScheduleDetailModal.tsx  # View details + actions
        └── ScheduleFormModal.tsx    # Create/Edit form

supabase/migrations/
├── 20251203_project_schedules.sql  # Schedule preferences table
└── 20251203_jobs_queue.sql         # Job queue table
```

---

## Future Evolution Paths

### Path A: Upgrade to Supabase Pro

If we upgrade Supabase ($25/mo), we can use pg_cron:

```sql
-- Enable pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Move schedule checking to database
SELECT cron.schedule('check-schedules', '*/15 * * * *', $$
  SELECT check_and_queue_due_schedules()
$$);
```

**Changes needed:**
- Add pg_cron SQL commands (manual in dashboard)
- Can optionally remove schedule checking from Python worker
- Job processing still happens in Render worker

### Path B: Add Render Cron Service

If we need more precise timing or separation:

```yaml
# render.yaml
- type: cron
  name: yarnnn-schedule-trigger
  schedule: "*/5 * * * *"
  startCommand: python scripts/check_schedules.py
```

**Changes needed:**
- Add cron service to render.yaml
- Create trigger script (just inserts jobs)
- Remove schedule checking from main worker

### Path C: External Queue (Redis, SQS)

If we need higher throughput or reliability:

```python
# New executor implementation
class RedisJobExecutor(JobExecutor):
    async def claim_jobs(self, job_types, limit):
        # Use Redis BRPOPLPUSH for atomic claim
        pass
```

**Changes needed:**
- Add Redis/SQS infrastructure
- Implement new executor class
- Swap executor in worker initialization
- Domain code unchanged

### Path D: Add Email Provider

When we add email notifications:

```python
@JobHandlerRegistry.register('email_notification')
async def handle_email(payload: dict) -> dict:
    from .email_service import send_email
    return await send_email(
        to=payload['recipient'],
        template=payload['template'],
        data=payload['data']
    )
```

**Changes needed:**
- Add email service (Resend, SendGrid, etc.)
- Register new job handler
- Create jobs from work output approval flow
- No infrastructure changes

### Path E: LLM Batch API

When OpenAI/Anthropic batch APIs are needed:

```python
@JobHandlerRegistry.register('llm_batch_submit')
async def handle_batch_submit(payload: dict) -> dict:
    # Submit batch to provider
    batch_id = await openai.batches.create(...)
    return {'batch_id': batch_id, 'status': 'submitted'}

@JobHandlerRegistry.register('llm_batch_complete')
async def handle_batch_complete(payload: dict) -> dict:
    # Process batch results (called via webhook)
    results = await openai.batches.retrieve(payload['batch_id'])
    # Update work outputs with results
    return {'processed': len(results)}
```

**Changes needed:**
- Add batch submission job type
- Add webhook endpoint for completion callback
- Register completion handler
- No infrastructure changes

---

## Related Features

### Context Roles Architecture

Scheduling is tightly integrated with context roles:
- Recipes declare `context_outputs.refresh_policy.ttl_hours`
- Stale detection uses this TTL
- Scheduled refresh produces new context blocks

See: [Context Roles Architecture](./context-roles.md) (if exists)

### Work Supervision

Scheduled work goes through the same supervision flow:
- Work tickets created with `source='scheduled'`
- Approval settings still apply
- Auto-promotion respects recipe settings

### Canonical Queue Processor

The job worker coexists with the canonical queue processor:
- Job worker: Creates work_tickets from schedules
- Canonical processor: Executes work_tickets via agents
- Both run in same Render service

---

## Appendix: Configuration Reference

### Schedule Frequencies

| Value | Meaning | Example |
|-------|---------|---------|
| `weekly` | Every 7 days | Monday 9am |
| `biweekly` | Every 14 days | Every other Monday |
| `monthly` | First occurrence of day in month | First Monday of month |
| `custom` | (future) Cron expression | `0 9 * * 1,3,5` |

### Job Statuses

| Status | Meaning | Transitions To |
|--------|---------|----------------|
| `pending` | Waiting to be processed | `claimed` |
| `claimed` | Worker has claimed it | `running` |
| `running` | Currently executing | `completed`, `failed` |
| `completed` | Successfully finished | (terminal) |
| `failed` | Failed after max retries | (terminal) |
| `cancelled` | Manually cancelled | (terminal) |

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `JOB_POLL_INTERVAL` | Seconds between job checks | 30 |
| `JOB_BATCH_SIZE` | Max jobs to claim per poll | 5 |
| `SCHEDULE_CHECK_INTERVAL` | Seconds between schedule checks | 900 (15 min) |

---

## Schedules Management UI (Phase 2)

Dedicated page for viewing and managing recurring schedules.

### User Flow
1. **View**: Schedules tab → list of configured schedules
2. **Create**: From recipe config page OR "+ New" button → recipe select → form
3. **Details**: Click card → modal with config + run history
4. **Edit/Delete**: From detail modal with confirmation

### Components
- **SchedulesClient**: List with real-time updates, state for modals
- **ScheduleCard**: Recipe name, frequency, next/last run, enable toggle
- **ScheduleDetailModal**: Full config view, edit/delete actions
- **ScheduleFormModal**: Recipe picker, frequency, day/time selectors

### Purge Integration
Project purge (`archive_all` mode) deletes schedules and cancels pending jobs.

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2024-12-03 | Initial implementation with Render worker | Claude |
| | Added project_schedules table | |
| | Added jobs queue abstraction | |
| | Integrated with RecipeConfigureClient UI | |
| 2024-12-03 | Phase 2: Schedules management page | Claude |
| | Added Schedules tab to project navigation | |
| | Added list/detail/form modal components | |
| | Integrated with project purge | |
