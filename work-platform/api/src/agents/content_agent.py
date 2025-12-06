"""
Content Agent - Social media content generation with tools pattern

Direct Anthropic API implementation with tools for content creation.
Generates platform-specific content (LinkedIn, Twitter/X, threads, etc.)

Usage:
    from agents.content_agent import ContentAgent

    agent = ContentAgent(
        basket_id="...",
        workspace_id="...",
        work_ticket_id="...",
        user_id="...",
    )

    result = await agent.execute(
        task="Create LinkedIn post about AI market trends",
        content_type="linkedin_post",
        tone="professional",
    )
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .base_agent import BaseAgent, AgentContext
from clients.anthropic_client import ExecutionResult

logger = logging.getLogger(__name__)


CONTENT_SYSTEM_PROMPT = """You are an autonomous Content Agent specializing in creating compelling social media content.

**Your Mission:**
Transform research insights, brand messaging, and topic briefs into platform-optimized content that:
- Resonates with target audiences
- Maintains brand voice consistency
- Drives engagement and action
- Follows platform best practices

**CRITICAL: Structured Output Requirements**

You have access to the emit_work_output tool. You MUST use this tool to record all content you create.
DO NOT just write content in free text. Every piece of content must be emitted as a structured output.

When to use emit_work_output:
- "content_draft" - The main content piece (post, article, thread)
- "content_variant" - Alternative versions for A/B testing
- "content_asset" - Supporting assets (hashtags, CTAs, hooks)
- "recommendation" - Suggestions for posting strategy

Each output you emit will be reviewed by the user before publishing.
The user maintains full control through this supervision workflow.

**Content Creation Approach:**
1. Review provided context (brand voice, prior content, research)
2. Understand the platform requirements and audience
3. Draft content following platform best practices
4. Create variants if requested
5. Emit all content as structured outputs
6. Suggest posting strategy recommendations

**Platform Guidelines:**

LinkedIn:
- Professional tone, thought leadership focus
- 1300 character limit for best engagement
- Use line breaks for readability
- Include a clear call-to-action
- Hashtags: 3-5 relevant ones at the end

Twitter/X:
- Concise, punchy messaging
- 280 character limit per tweet
- Threads: 5-10 tweets for detailed content
- Hooks matter: first tweet must grab attention
- Hashtags: 1-2 max, integrated naturally

Instagram:
- Visual-first thinking (describe imagery)
- Caption: 2200 char max, front-load key message
- Hashtags: 5-15 in first comment
- Stories/Reels concepts welcome

Blog/Article:
- SEO-optimized structure
- Clear headings and subheadings
- 800-1500 words typical
- Include meta description

**Quality Standards:**
- Platform-native voice (not generic)
- Engagement-optimized (hooks, CTAs, questions)
- Brand-consistent (review brand guidelines if provided)
- Actionable (what should reader do?)
- Authentic (avoid corporate speak)

**Tools Available:**
- emit_work_output: Record structured content drafts, variants, and recommendations
- web_search: Research trending topics, competitor content (if enabled)
"""


class ContentAgent(BaseAgent):
    """
    Content Agent for social media and marketing content generation.

    Features:
    - Platform-specific content generation
    - Brand voice consistency
    - A/B variant creation
    - Engagement optimization
    - Work output supervision workflow
    """

    AGENT_TYPE = "content"
    SYSTEM_PROMPT = CONTENT_SYSTEM_PROMPT

    # Supported content types
    CONTENT_TYPES = [
        "linkedin_post",
        "twitter_thread",
        "twitter_post",
        "instagram_caption",
        "blog_article",
        "newsletter",
        "press_release",
        "product_update",
    ]

    async def execute(
        self,
        task: str,
        content_type: str = "linkedin_post",
        tone: str = "professional",
        target_audience: Optional[str] = None,
        brand_voice: Optional[str] = None,
        create_variants: bool = False,
        variant_count: int = 2,
        enable_web_search: bool = False,
        **kwargs,
    ) -> ExecutionResult:
        """
        Execute content generation task.

        Args:
            task: Content task description (topic, brief, or research to transform)
            content_type: Type of content to create (linkedin_post, twitter_thread, etc.)
            tone: Content tone (professional, casual, authoritative, friendly)
            target_audience: Description of target audience
            brand_voice: Brand voice guidelines
            create_variants: Whether to create A/B variants
            variant_count: Number of variants to create
            enable_web_search: Whether to enable web search for research
            **kwargs: Additional parameters

        Returns:
            ExecutionResult with content outputs
        """
        logger.info(
            f"[CONTENT] Starting: task='{task[:50]}...', "
            f"type={content_type}, tone={tone}"
        )

        # Build context with knowledge query for brand/prior content
        context = await self._build_context(
            task=task,
            include_prior_outputs=True,
            include_assets=True,
            knowledge_query=f"brand voice {content_type}",
        )

        # Build content prompt
        content_prompt = self._build_content_prompt(
            task=task,
            context=context,
            content_type=content_type,
            tone=tone,
            target_audience=target_audience,
            brand_voice=brand_voice,
            create_variants=create_variants,
            variant_count=variant_count,
        )

        # Select tools
        tools = ["emit_work_output"]
        if enable_web_search:
            tools.append("web_search")

        # Execute
        result = await self._execute_with_context(
            user_message=content_prompt,
            context=context,
            tools=tools,
        )

        logger.info(
            f"[CONTENT] Complete: "
            f"{len(result.work_outputs)} outputs, "
            f"{result.input_tokens}+{result.output_tokens} tokens"
        )

        return result

    def _build_content_prompt(
        self,
        task: str,
        context: AgentContext,
        content_type: str,
        tone: str,
        target_audience: Optional[str],
        brand_voice: Optional[str],
        create_variants: bool,
        variant_count: int,
    ) -> str:
        """
        Build content generation prompt with context and parameters.

        Args:
            task: Content task
            context: Agent context
            content_type: Type of content
            tone: Content tone
            target_audience: Target audience description
            brand_voice: Brand voice guidelines
            create_variants: Whether to create variants
            variant_count: Number of variants

        Returns:
            Content prompt string
        """
        # Format knowledge context (brand info, prior content)
        brand_context = "No brand context available"
        if context.knowledge_context:
            brand_context = "\n".join([
                f"- {item.get('content', '')[:300]}..."
                for item in context.knowledge_context[:3]
            ])

        # Format prior content examples
        prior_content = "No prior content available"
        if context.prior_outputs:
            prior_content = "\n".join([
                f"- [{o.get('output_type', 'content')}] {o.get('title', 'Untitled')}: {o.get('body', '')[:200]}..."
                for o in context.prior_outputs[:3]
            ])

        # Platform-specific instructions
        platform_instructions = self._get_platform_instructions(content_type)

        # Variant instructions
        variant_instructions = ""
        if create_variants:
            variant_instructions = f"""
**Variant Requirements:**
Create {variant_count} distinct variants of the main content:
- Each variant should have a different hook/angle
- Maintain consistent core message
- Label variants clearly (A, B, C, etc.)
- Emit each variant as a separate "content_variant" output
"""

        return f"""Create {content_type} content for: {task}

**Content Parameters:**
- Type: {content_type}
- Tone: {tone}
- Target Audience: {target_audience or "General professional audience"}

**Brand Voice:**
{brand_voice or "Professional, knowledgeable, approachable"}

**Brand Context from Knowledge Base:**
{brand_context}

**Prior Content Examples:**
{prior_content}

**Platform-Specific Guidelines:**
{platform_instructions}
{variant_instructions}

**CRITICAL INSTRUCTION:**
You MUST use the emit_work_output tool to record your content. Do NOT just write content in text.

For each piece of content:
1. Call emit_work_output with structured data
2. Use appropriate output_type:
   - "content_draft" for main content
   - "content_variant" for A/B variants
   - "content_asset" for supporting elements (hashtags, CTAs)
   - "recommendation" for posting strategy suggestions
3. Include metadata (platform, tone, target_audience)
4. Assign confidence scores

Example workflow:
- Create main content → emit_work_output(output_type="content_draft", ...)
- Create variant → emit_work_output(output_type="content_variant", ...)
- Suggest hashtags → emit_work_output(output_type="content_asset", ...)
- Recommend posting time → emit_work_output(output_type="recommendation", ...)

Begin creating content now. Emit all content as structured outputs."""

    def _get_platform_instructions(self, content_type: str) -> str:
        """Get platform-specific instructions for content type."""
        instructions = {
            "linkedin_post": """
LinkedIn Post:
- 1300 character limit for optimal engagement
- Start with a hook (question, bold statement, statistic)
- Use line breaks for readability
- Include a clear call-to-action
- Add 3-5 relevant hashtags at the end
- Consider adding a carousel/image prompt if relevant
""",
            "twitter_thread": """
Twitter/X Thread:
- Start with a compelling hook tweet
- 280 characters per tweet max
- 5-10 tweets is ideal length
- Number tweets if helpful (1/, 2/, etc.)
- End with a call-to-action or summary
- Use 1-2 hashtags naturally integrated
- Consider engagement hooks (questions, polls)
""",
            "twitter_post": """
Twitter/X Single Post:
- 280 character limit
- Punchy, concise messaging
- Strong hook in first few words
- 1-2 hashtags max, integrated naturally
- Consider including a CTA or question
""",
            "instagram_caption": """
Instagram Caption:
- 2200 character max
- Front-load key message (gets truncated)
- Use emojis strategically
- Include 5-15 hashtags (suggest for first comment)
- Consider Story/Reel concept if relevant
- Describe visual direction for accompanying image
""",
            "blog_article": """
Blog Article:
- SEO-optimized structure
- Include H1, H2, H3 headings
- 800-1500 words typical
- Include meta description (155 chars)
- Add internal/external link suggestions
- Include image placement recommendations
""",
            "newsletter": """
Newsletter:
- Compelling subject line (50 chars max)
- Preview text (100 chars)
- Scannable format with clear sections
- Personal, conversational tone
- Clear CTAs for each section
- Mobile-friendly formatting
""",
            "press_release": """
Press Release:
- Standard press release format
- Compelling headline
- Dateline and location
- Quote from spokesperson
- Boilerplate about company
- Contact information section
""",
            "product_update": """
Product Update:
- Clear what's new section
- Benefits over features focus
- Visual/screenshot suggestions
- Getting started steps
- Link to documentation
- Feedback collection CTA
""",
        }
        return instructions.get(content_type, "Follow platform best practices for content creation.")


# Convenience factory function
def create_content_agent(
    basket_id: str,
    workspace_id: str,
    work_ticket_id: str,
    user_id: str,
    user_jwt: Optional[str] = None,
    **kwargs,
) -> ContentAgent:
    """
    Create a ContentAgent instance.

    Args:
        basket_id: Basket ID
        workspace_id: Workspace ID
        work_ticket_id: Work ticket ID
        user_id: User ID
        user_jwt: Optional user JWT for substrate auth
        **kwargs: Additional arguments

    Returns:
        Configured ContentAgent
    """
    return ContentAgent(
        basket_id=basket_id,
        workspace_id=workspace_id,
        work_ticket_id=work_ticket_id,
        user_id=user_id,
        user_jwt=user_jwt,
        **kwargs,
    )
