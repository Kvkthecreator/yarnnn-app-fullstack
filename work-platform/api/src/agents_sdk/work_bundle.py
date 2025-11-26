"""
Work Bundle - Work ticket metadata package for specialist agent execution.

This is NOT a database model - it's a transient data structure passed to agents.

Architecture (2025-11):
- WorkBundle = METADATA ONLY (task description, priorities, asset pointers)
- Substrate = QUERIED ON-DEMAND by agents via SubstrateQueryAdapter (substrate.query())
- This separation provides: token efficiency (lazy loading), agent autonomy, clear concerns

WorkBundle is the "agent-facing work ticket" - a stamp of work details,
NOT a container for substrate context.
"""

from typing import Any, Dict, List, Optional


class WorkBundle:
    """
    Work ticket metadata package for specialist agent execution.

    Architecture:
    - WorkBundle contains: task metadata, reference asset pointers, agent config
    - WorkBundle does NOT contain substrate blocks (removed - agents query on-demand)
    - Agents access substrate via: SubstrateQueryAdapter.query() (on-demand, lazy)

    This separation enables:
    - Token efficiency (agents query only what they need)
    - Agent autonomy (agents decide their own context)
    - Clear separation (session ≠ substrate ≠ work metadata)

    This is an in-memory structure, not persisted to database.
    """

    def __init__(
        self,
        # Work tracking IDs
        work_request_id: str,
        work_ticket_id: str,
        basket_id: str,
        workspace_id: str,
        user_id: str,
        # Task definition
        task: str,
        agent_type: str,
        priority: str = "medium",
        # Reference asset pointers (NOT full content)
        reference_assets: Optional[List[Dict[str, Any]]] = None,
        # Agent configuration
        agent_config: Optional[Dict[str, Any]] = None,
        user_requirements: Optional[Dict[str, Any]] = None,
    ):
        """
        Initialize work bundle (metadata only).

        Args:
            work_request_id: Work request UUID
            work_ticket_id: Work ticket UUID
            basket_id: Basket UUID
            workspace_id: Workspace UUID
            user_id: User UUID
            task: Task description from user
            agent_type: "research" | "content" | "reporting"
            priority: "high" | "medium" | "low"
            reference_assets: Asset pointers (file IDs, URLs) - NOT full content
            agent_config: Agent configuration from database
            user_requirements: Additional requirements from chat collection
        """
        self.work_request_id = work_request_id
        self.work_ticket_id = work_ticket_id
        self.basket_id = basket_id
        self.workspace_id = workspace_id
        self.user_id = user_id
        self.task = task
        self.agent_type = agent_type
        self.priority = priority
        self.reference_assets = reference_assets or []
        self.agent_config = agent_config or {}
        self.user_requirements = user_requirements or {}

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict for JSON serialization."""
        return {
            "work_request_id": self.work_request_id,
            "work_ticket_id": self.work_ticket_id,
            "basket_id": self.basket_id,
            "workspace_id": self.workspace_id,
            "user_id": self.user_id,
            "task": self.task,
            "agent_type": self.agent_type,
            "priority": self.priority,
            "reference_assets": self.reference_assets,
            "agent_config": self.agent_config,
            "user_requirements": self.user_requirements,
        }

    def get_context_summary(self) -> str:
        """Get human-readable summary of bundle context."""
        return f"""Work Bundle Summary:
- Task: {self.task[:100]}...
- Agent: {self.agent_type}
- Reference Assets: {len(self.reference_assets)}
- Config Keys: {list(self.agent_config.keys())}
"""

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorkBundle":
        """Create WorkBundle from dict."""
        return cls(
            work_request_id=data["work_request_id"],
            work_ticket_id=data["work_ticket_id"],
            basket_id=data["basket_id"],
            workspace_id=data["workspace_id"],
            user_id=data["user_id"],
            task=data["task"],
            agent_type=data["agent_type"],
            priority=data.get("priority", "medium"),
            reference_assets=data.get("reference_assets"),
            agent_config=data.get("agent_config"),
            user_requirements=data.get("user_requirements"),
        )
