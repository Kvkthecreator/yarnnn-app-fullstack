# YARNNN Documentation

**Comprehensive Documentation for YARNNN v4.0 AI Work Platform**

**Last Updated**: 2026-01-28

---

## 🎯 Quick Start

**New to YARNNN?** Start here:

1. **Philosophy** → [YARNNN Platform Canon v4.0](canon/YARNNN_PLATFORM_CANON_V4.md)
2. **Architecture** → [Layered Architecture v4.0](architecture/YARNNN_LAYERED_ARCHITECTURE_V4.md)
3. **Implementation** → [YARNNN Architecture Canon](YARNNN_ARCHITECTURE_CANON.md)

**Looking for specific features?** → [Features Directory](#features)

**Historical documentation?** → [Archive Directory](archive/)

---

## 📚 Documentation Structure

### 1. Canon (Philosophy & Principles)

**Location**: [`canon/`](canon/)

**Purpose**: Immutable principles and core philosophy

**Documents**:
- [YARNNN_PLATFORM_CANON_V4.md](canon/YARNNN_PLATFORM_CANON_V4.md) - Core identity and philosophy
- [YARNNN_WORK_PLATFORM_THESIS.md](canon/YARNNN_WORK_PLATFORM_THESIS.md) - Product vision and value proposition
- [YARNNN_GOVERNANCE_PHILOSOPHY_V4.md](canon/YARNNN_GOVERNANCE_PHILOSOPHY_V4.md) - Governance principles
- [YARNNN_PROVENANCE_PHILOSOPHY.md](canon/YARNNN_PROVENANCE_PHILOSOPHY.md) - Audit trail principles
- [YARNNN_USER_EXPERIENCE_PRINCIPLES.md](canon/YARNNN_USER_EXPERIENCE_PRINCIPLES.md) - UX guidelines

**When to Read**: Understanding the "why" behind design decisions

---

### 2. Architecture (System Design)

**Location**: [`architecture/`](architecture/)

**Purpose**: Living system design references

**Documents**:
- [YARNNN_LAYERED_ARCHITECTURE_V4.md](architecture/YARNNN_LAYERED_ARCHITECTURE_V4.md) - Four-layer architecture
- [YARNNN_UNIFIED_GOVERNANCE.md](architecture/YARNNN_UNIFIED_GOVERNANCE.md) - Unified governance layer
- [YARNNN_DATA_FLOW_V4.md](architecture/YARNNN_DATA_FLOW_V4.md) - Complete request flows
- [YARNNN_API_SURFACE.md](architecture/YARNNN_API_SURFACE.md) - API reference

**When to Read**: Understanding system structure and data flows

---

### 3. Features (Detailed Specifications)

**Location**: [`features/`](features/)

**Purpose**: Detailed feature specifications with schemas, APIs, and implementation examples

#### Work Management ([`features/work-management/`](features/work-management/))
- [WORK_SESSION_LIFECYCLE.md](features/work-management/WORK_SESSION_LIFECYCLE.md) - Agent work execution states
- [ARTIFACT_TYPES_AND_HANDLING.md](features/work-management/ARTIFACT_TYPES_AND_HANDLING.md) - 9 artifact types and processing
- [CHECKPOINT_STRATEGIES.md](features/work-management/CHECKPOINT_STRATEGIES.md) - Multi-stage approval workflows
- [AGENT_SDK_INTEGRATION.md](features/work-management/AGENT_SDK_INTEGRATION.md) - Agent SDK integration patterns

#### Governance ([`features/governance/`](features/governance/))
- [WORKSPACE_POLICIES.md](features/governance/WORKSPACE_POLICIES.md) - Per-workspace governance configuration
- [APPROVAL_WORKFLOWS.md](features/governance/APPROVAL_WORKFLOWS.md) - Complete review flows
- [RISK_ASSESSMENT.md](features/governance/RISK_ASSESSMENT.md) - Multi-factor risk calculation
- [AUDIT_TRAILS.md](features/governance/AUDIT_TRAILS.md) - Complete provenance tracking

#### Integrations ([`features/integrations/`](features/integrations/))
- [AGENT_PROVIDERS.md](features/integrations/AGENT_PROVIDERS.md) - YARNNN provider implementations
- [TIMELINE_AND_NOTIFICATIONS.md](features/integrations/TIMELINE_AND_NOTIFICATIONS.md) - Event stream and notifications

**When to Read**: Implementing specific features or understanding detailed behavior

---

### 4. Core Reference Documents

**Location**: [`docs/`](.) (root)

**Core Documents**:
- [YARNNN_ARCHITECTURE_CANON.md](YARNNN_ARCHITECTURE_CANON.md) - Deployment architecture and implementation status
- [YARNNN_SUBSTRATE_CANON_V3.md](YARNNN_SUBSTRATE_CANON_V3.md) - Substrate layer reference (updated for v4.0)
- [WORK_ORCHESTRATION_LAYER.md](WORK_ORCHESTRATION_LAYER.md) - Layer 2 implementation details
- [YARNNN_CANON.md](YARNNN_CANON.md) - v3.1 canon (historical, superseded by v4.0 docs)

**When to Read**: Quick reference for substrate or work orchestration implementation

---

### 5. Fixes (Implementation Logs)

**Location**: [`fixes/`](fixes/)

**Purpose**: Implementation summaries and fix documentation

**Contents**:
- Work outputs fixes and migrations
- Frontend integration updates
- Recipe execution flow fixes
- Architecture correction logs

**When to Read**: Debugging similar issues or understanding implementation history

---

### 6. Deployment (Deployment Guides)

**Location**: [`deployment/`](deployment/)

**Purpose**: Deployment guides, phase summaries, and operational documentation

**Contents**:
- Phase implementation summaries (1-6)
- Deployment guides and status
- Local development setup
- Skills implementation guides

**When to Read**: Deploying, operating, or extending YARNNN

---

### 7. Archive (Historical Documentation)

**Location**: [`archive/`](archive/)

**Purpose**: Historical documentation from previous versions

**Contents**:
- `v3.1/` - Context OS (v3.1) documentation
- `v3.0/` - Unified Substrate (v3.0) documentation
- `features/` - Old feature specifications and canonical documents
- `planning/` - Implementation plans and refactoring documents
- `migrations/` - Database and API migration guides
- `mcp/` - MCP server specifications
- `deployment-phases/` - Archived phase implementation details
- `fixes/` - Archived fix iterations
- `deprecated/` - Obsolete documentation

**When to Read**: Understanding YARNNN's evolution or troubleshooting legacy code

**⚠️ Important**: Archive documents are **historical references only**, not authoritative for current implementation.

See: [Archive INDEX](archive/INDEX.md) for complete navigation

---

## 🔍 Finding Information

### By Topic

**How does governance work?** → [Unified Governance](architecture/YARNNN_UNIFIED_GOVERNANCE.md)

**How do agents integrate?** → [Agent SDK Integration](features/work-management/AGENT_SDK_INTEGRATION.md)

**What are work artifacts?** → [Artifact Types](features/work-management/ARTIFACT_TYPES_AND_HANDLING.md)

**How is risk calculated?** → [Risk Assessment](features/governance/RISK_ASSESSMENT.md)

**How do notifications work?** → [Timeline and Notifications](features/integrations/TIMELINE_AND_NOTIFICATIONS.md)

**What's the substrate?** → [Substrate Canon V3](YARNNN_SUBSTRATE_CANON_V3.md)

**What's the API surface?** → [API Surface](architecture/YARNNN_API_SURFACE.md)

### By Role

**Product Manager** → Start with [Work Platform Thesis](canon/YARNNN_WORK_PLATFORM_THESIS.md)

**Engineer** → Start with [Layered Architecture](architecture/YARNNN_LAYERED_ARCHITECTURE_V4.md) → [Data Flow](architecture/YARNNN_DATA_FLOW_V4.md)

**Frontend Developer** → [UX Principles](canon/YARNNN_USER_EXPERIENCE_PRINCIPLES.md) → [Data Flow](architecture/YARNNN_DATA_FLOW_V4.md) → [Timeline and Notifications](features/integrations/TIMELINE_AND_NOTIFICATIONS.md)

**Backend Developer** → [Architecture Canon](YARNNN_ARCHITECTURE_CANON.md) → [Work Orchestration Layer](WORK_ORCHESTRATION_LAYER.md) → [API Surface](architecture/YARNNN_API_SURFACE.md)

**Agent SDK Developer** → [Agent SDK Integration](features/work-management/AGENT_SDK_INTEGRATION.md) → [Agent Providers](features/integrations/AGENT_PROVIDERS.md)

**QA/Auditor** → [Audit Trails](features/governance/AUDIT_TRAILS.md) → [Provenance Philosophy](canon/YARNNN_PROVENANCE_PHILOSOPHY.md)

---

## 📊 Version History

| Version | Date | Key Changes |
|---------|------|-------------|
| **v4.0** | 2025-10-31 | AI Work Platform: Added Layer 2 (Work Orchestration), Layer 3 (Unified Governance), integrated Agent SDK |
| **v3.1** | 2025-01-15 | Context OS: Added semantic intelligence layer (vector embeddings + causal relationships) |
| **v3.0** | 2024-12 | Unified Substrate: Consolidated context_items → blocks, emergent anchors, universal versioning |

See: [Archive INDEX](archive/INDEX.md) for complete version comparison

---

## 🚀 YARNNN v4.0 Overview

### What is YARNNN?

**YARNNN v4.0** is an **AI Work Platform** that combines:

1. **Deep Context Understanding** (Layer 1: Substrate Core)
2. **Structured Work Orchestration** (Layer 2: Work Orchestration)
3. **Intelligent Oversight** (Layer 3: Unified Governance)
4. **Intuitive User Experience** (Layer 4: Presentation)

### Key Concepts

**Work Sessions**: Agent execution lifecycle from task → completion

**Work Artifacts**: Agent outputs (block proposals, document drafts, insights) awaiting approval

**Checkpoints**: Multi-stage approval workflows (plan → mid-work → artifact → final)

**Risk Assessment**: Multi-factor algorithm guiding user attention

**Substrate**: Universal knowledge storage (blocks, documents, relationships)

**Unified Governance**: Single approval flow for work quality → automatic substrate updates

**Complete Provenance**: Every substrate change traces to work session → artifact → agent reasoning → user approval

---

## 📖 Reading the Documentation

### Document Headers

All canonical documents include standardized headers:

```markdown
**Version**: 4.0
**Date**: 2025-10-31
**Status**: ✅ Canonical
**Layer**: [1-4]
**Category**: [Canon | Architecture | Feature Specification]
```

**Status Indicators**:
- ✅ Canonical - Current authoritative reference
- 🔄 Draft - Work in progress
- ⚠️ Historical - Superseded by newer version
- ❌ Deprecated - No longer applicable

### Cross-References

Documents extensively cross-reference each other using relative links:

```markdown
See: [YARNNN_DATA_FLOW_V4.md](../../architecture/YARNNN_DATA_FLOW_V4.md)
```

**Tip**: Use your IDE's "Go to Definition" feature on markdown links to navigate quickly.

---

## 🤝 Contributing to Documentation

### When to Update

**Canon** (philosophy): Rarely - only when core principles change

**Architecture** (system design): When architectural patterns or layer responsibilities change

**Features** (specifications): When feature behavior, APIs, or schemas change

**Core Reference**: When substrate or work orchestration implementation changes

### Documentation Standards

1. **Include Version and Date**: All documents must have version headers
2. **Status Indicators**: Use ✅/🔄/⚠️/❌ to show document status
3. **Cross-Reference**: Link to related documents in "See Also" sections
4. **Code Examples**: Include TypeScript interfaces, SQL schemas, Python code
5. **Diagrams**: Use ASCII diagrams for flows and state machines
6. **Metrics**: Document observable metrics where applicable

### Archiving Old Docs

When superseding a document:

1. Add status header to old document pointing to new version
2. Move old document to appropriate `archive/` subdirectory
3. Update [archive/INDEX.md](archive/INDEX.md) with entry
4. Update cross-references in current docs

---

## 📎 External References

**Repository**: [rightnow-agent-app-fullstack](../../)

**Web App**: `/web` directory (Next.js)

**Backend**: `/core` directory (Python FastAPI)

**Database**: Supabase (PostgreSQL + pgvector)

**Agent SDK**: `claude-agentsdk-yarnnn` (generic agent framework)

---

## 🔗 Quick Links

**Start Here**: [YARNNN Platform Canon v4.0](canon/YARNNN_PLATFORM_CANON_V4.md)

**Architecture**: [Layered Architecture v4.0](architecture/YARNNN_LAYERED_ARCHITECTURE_V4.md)

**Implementation**: [YARNNN Architecture Canon](YARNNN_ARCHITECTURE_CANON.md)

**Archive**: [Archive INDEX](archive/INDEX.md)

**Refactor Plan**: [DOCUMENTATION_REFACTOR_PLAN_V4.md](DOCUMENTATION_REFACTOR_PLAN_V4.md) (how this structure was created)

---

**Documentation Principle**: Clear structure, comprehensive cross-references, version-aware. When in doubt, check current docs first, then consult archive for historical context.
