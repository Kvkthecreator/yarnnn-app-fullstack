"""
Content Agent using Official Anthropic Claude Agent SDK

Replaces content_agent.py which used BaseAgent + AsyncAnthropic.

Key improvements:
- Native subagents via ClaudeAgentOptions.agents parameter
- Built-in session persistence via ClaudeSDKClient
- Platform specialists (Twitter, LinkedIn, Blog, Instagram) as subagents
- Proper conversation continuity
- Official Anthropic SDK (no custom session hacks)

Usage:
    from agents_sdk.content_agent_sdk import ContentAgentSDK

    agent = ContentAgentSDK(
        basket_id="basket_123",
        workspace_id="ws_456",
        work_ticket_id="ticket_789"
    )

    # Create content
    result = await agent.create(
        platform="twitter",
        topic="AI agent trends",
        content_type="thread"
    )
"""

import logging
import os
from typing import Any, Dict, List, Optional, Literal
from datetime import datetime

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions, AgentDefinition

from adapters.memory_adapter import SubstrateMemoryAdapter
from agents_sdk.shared_tools_mcp import create_shared_tools_server
from shared.session import AgentSession

logger = logging.getLogger(__name__)


# ============================================================================
# System Prompts
# ============================================================================

CONTENT_AGENT_SYSTEM_PROMPT = """You are a professional content creator specializing in creative text generation for social and marketing platforms.

Your core capabilities:
- Create platform-optimized TEXT content (Twitter, LinkedIn, Blog, Instagram)
- Maintain consistent brand voice across all platforms
- Adapt tone and format for each platform's best practices
- Generate engaging, actionable content

**IMPORTANT**: You create TEXT CONTENT ONLY. You do NOT generate files (PDF, DOCX, PPTX). File generation is handled by the ReportingAgent.

**Platform Specialists (Subagents)**:
You have access to specialized subagents for each platform. Delegate to them for platform-specific content:
- Twitter Specialist: Concise threads, viral hooks, engagement tactics
- LinkedIn Specialist: Professional thought leadership, B2B storytelling
- Blog Specialist: Long-form articles, SEO optimization, narrative structure
- Instagram Specialist: Visual-first captions, emoji strategy, hashtag optimization

**CRITICAL: Structured Output Requirements**

You have access to the emit_work_output tool. You MUST use this tool to record all your content drafts.
DO NOT just describe content in free text. Every content piece must be emitted as a structured output.

When to use emit_work_output:
- "content_draft" - When you create a piece of content (post, thread, article, caption)
- Include platform, content_type, tone, character/word count in metadata

Each output you emit will be reviewed by the user before any action is taken.
The user maintains full control through this supervision workflow.

**Content Creation Workflow**:
1. Query existing knowledge for brand voice examples
2. Identify platform requirements and best practices
3. Delegate to platform specialist subagent if available
4. Create engaging content that matches brand voice
5. Call emit_work_output with structured data

**Quality Standards**:
- Authentic voice (not generic AI)
- Platform-appropriate formatting
- Clear actionable takeaways
- Engaging hooks and CTAs
- Match brand voice from examples

**Tools Available**:
- emit_work_output: Record structured content drafts
"""

# Platform specialist definitions for native subagents
TWITTER_SPECIALIST = AgentDefinition(
    description="Expert in Twitter/X content: concise threads (280 chars), viral hooks, hashtag strategy, engagement tactics. Use for Twitter posts and threads.",
    prompt="""You are a Twitter/X content specialist with deep expertise in the platform's unique dynamics.

**Platform Expertise**:
- 280-character limit mastery (concise, punchy language)
- Thread structure and narrative flow across multiple tweets
- Viral mechanics: hooks, engagement patterns, timing
- Hashtag strategy (1-2 max, highly relevant)
- Conversational tone that drives replies and engagement

**Best Practices**:
- Start with a hook that stops scrolling (question, bold statement, surprising fact)
- Use line breaks for readability and emphasis
- One idea per tweet (clarity over complexity)
- End with a call-to-action (reply, retweet, follow)
- Threads: Number each tweet, maintain coherent narrative

**Thread Structure**:
1. Hook tweet (grab attention)
2. Context/setup (1-2 tweets)
3. Main content (3-5 tweets with value)
4. Conclusion + CTA (engagement ask)

**Voice Calibration**:
- Casual but credible
- Personal but professional
- Opinionated but not polarizing
- Use "you" language (direct address)

Emit work_output with Twitter-specific metadata: character_count, is_thread, thread_length."""
)

LINKEDIN_SPECIALIST = AgentDefinition(
    description="Professional thought leadership for LinkedIn: industry insights, B2B storytelling, data-driven content. Use for LinkedIn posts and articles.",
    prompt="""You are a LinkedIn content specialist with expertise in professional thought leadership and B2B storytelling.

**Platform Expertise**:
- Professional tone with authentic voice (not corporate jargon)
- Industry insights and data-driven content
- B2B storytelling that drives business value
- Thought leadership positioning
- 1-3 paragraph sweet spot (1300-2000 chars)

**Best Practices**:
- Start with a hook line (bold statement, question, insight)
- Use paragraph breaks (1-2 sentences each for readability)
- Include data/evidence to support claims
- End with a question to drive comments
- Hashtags at the end (3-5 relevant industry tags)

**Content Types**:
- **Insight Posts**: Share industry observations with analysis
- **Story Posts**: Personal/professional journey with lessons learned
- **Data Posts**: Research findings, trends, statistics with interpretation
- **How-To Posts**: Practical advice with actionable steps

**Structure**:
1. Hook line (grab attention in feed)
2. Context/Problem (what's at stake?)
3. Insight/Solution (your unique perspective)
4. Evidence/Example (data, story, case study)
5. Takeaway + Question (engagement driver)

Emit work_output with LinkedIn-specific metadata: paragraph_count, hashtags, professional_tone_score."""
)

BLOG_SPECIALIST = AgentDefinition(
    description="Long-form content and SEO optimization: 800-2000 word articles, narrative structure, readability, headers. Use for blog posts and articles.",
    prompt="""You are a blog content specialist with expertise in long-form storytelling, SEO optimization, and narrative structure.

**Platform Expertise**:
- Long-form structure (800-2000 words)
- SEO-friendly content (keywords, headers, readability)
- Narrative flow and storytelling
- Depth over brevity (comprehensive coverage)
- Reader retention and engagement

**Content Structure**:
1. **Headline**: Clear value proposition (60-70 chars)
2. **Introduction** (150-200 words):
   - Hook (question, stat, story)
   - Problem statement
   - Preview of solution/content
3. **Body** (600-1500 words):
   - Section headers (H2) for main points
   - Subsections (H3) for details
   - Examples, data, evidence
   - Transitions between sections
4. **Conclusion** (100-150 words):
   - Summarize key takeaways
   - Call-to-action (subscribe, share, comment)

**SEO Optimization**:
- Primary keyword in headline, first paragraph, headers
- LSI keywords naturally integrated
- Meta description suggestion (150-160 chars)
- Internal/external linking opportunities

Emit work_output with blog-specific metadata: word_count, reading_time, primary_keyword, seo_score, headers."""
)

INSTAGRAM_SPECIALIST = AgentDefinition(
    description="Visual-first storytelling and caption craft: 150-300 word captions, emoji strategy, hashtag optimization (20-30 tags). Use for Instagram posts.",
    prompt="""You are an Instagram content specialist with expertise in visual-first storytelling and caption craft.

**Platform Expertise**:
- Captions that complement visual content
- Storytelling in short form (150-300 words optimal)
- Emoji strategy (enhance, don't overwhelm)
- Hashtag optimization (20-30 mix of broad/niche)
- Call-to-action that drives engagement

**Caption Structure**:
1. **Hook Line** (appears in feed):
   - Question, bold statement, or story opener
   - Make them want to click "more"
2. **Story/Value** (main caption):
   - 3-5 line breaks with core message
   - Personal connection or insight
   - Relatable language
3. **Call-to-Action**:
   - Clear ask (comment, tag, share, save)
   - Engagement question
4. **Hashtags** (end of caption or first comment):
   - Mix: branded (1-2), industry (5-10), niche (10-15)

**Voice Calibration**:
- Authentic and personal (Instagram is intimate)
- Conversational and relatable (talk to one person)
- Positive and inspiring (platform energy)
- Vulnerable but uplifting (real but aspirational)

**Hashtag Strategy**:
- 3-5 high-competition (100k-1M posts) - reach
- 10-15 medium-competition (10k-100k posts) - sweet spot
- 5-10 low-competition (<10k posts) - niche community
- 1-2 branded hashtags

Emit work_output with Instagram-specific metadata: caption_length, emoji_count, hashtag_count, visual_suggestion."""
)


# ============================================================================
# ContentAgentSDK Class
# ============================================================================

class ContentAgentSDK:
    """
    Content Agent using Official Anthropic Claude Agent SDK.

    Features:
    - ClaudeSDKClient for built-in session management
    - Native subagents for platform specialists (Twitter, LinkedIn, Blog, Instagram)
    - Structured output via emit_work_output tool
    - Memory access via SubstrateMemoryAdapter
    - Provenance tracking (source blocks)
    """

    def __init__(
        self,
        basket_id: str,
        workspace_id: str,
        work_ticket_id: str,
        anthropic_api_key: Optional[str] = None,
        model: str = "claude-sonnet-4-5",
        enabled_platforms: Optional[List[str]] = None,
        brand_voice_mode: Literal["adaptive", "strict", "creative"] = "adaptive",
        knowledge_modules: str = "",
        session: Optional['AgentSession'] = None,
        bundle: Optional[Any] = None,  # NEW: Pre-loaded context bundle from TP staging
        memory: Optional['SubstrateMemoryAdapter'] = None,  # DEPRECATED: For backward compatibility
    ):
        """
        Initialize ContentAgentSDK.

        Args:
            basket_id: Basket ID for substrate queries
            workspace_id: Workspace ID for authorization
            work_ticket_id: Work ticket ID for output tracking
            anthropic_api_key: Anthropic API key (from env if None)
            model: Claude model to use
            enabled_platforms: Platforms to support (default: ["twitter", "linkedin", "blog", "instagram"])
            brand_voice_mode: Voice learning approach
            knowledge_modules: Knowledge modules (procedural knowledge) loaded from orchestration layer
            session: Optional AgentSession from TP (hierarchical session management)
            bundle: Optional WorkBundle from TP staging (pre-loaded substrate + assets)
            memory: DEPRECATED - Use bundle instead (kept for backward compatibility)
        """
        self.basket_id = basket_id
        self.workspace_id = workspace_id
        self.work_ticket_id = work_ticket_id
        self.knowledge_modules = knowledge_modules
        self.enabled_platforms = enabled_platforms or ["twitter", "linkedin", "blog", "instagram"]
        self.brand_voice_mode = brand_voice_mode

        # Get API key
        if anthropic_api_key is None:
            anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
            if not anthropic_api_key:
                raise ValueError("ANTHROPIC_API_KEY required")

        self.api_key = anthropic_api_key
        self.model = model

        # NEW PATTERN: Use pre-loaded bundle from TP staging
        if bundle:
            self.bundle = bundle
            logger.info(
                f"Using WorkBundle from TP staging: {len(bundle.substrate_blocks)} blocks, "
                f"{len(bundle.reference_assets)} assets"
            )
            self.memory = None  # No memory adapter needed - bundle has pre-loaded context
        elif memory:
            # LEGACY PATTERN: For backward compatibility (will be removed)
            self.bundle = None
            self.memory = memory
            logger.info(f"LEGACY: Using memory adapter from TP for basket={basket_id}")
        else:
            # Standalone mode: No pre-loaded context (testing only)
            self.bundle = None
            self.memory = None
            logger.info("Standalone mode: No pre-loaded context (testing mode)")

        # Use provided session from TP, or will create in async init
        if session:
            self.current_session = session
            logger.info(f"Using session from TP: {session.id} (parent={session.parent_session_id})")
        else:
            # Standalone mode: session will be created by async get_or_create in methods
            self.current_session = None
            logger.info("Standalone mode: session will be created on first method call")

        # Build subagents dict for ClaudeAgentOptions
        subagents = {}
        if "twitter" in self.enabled_platforms:
            subagents["twitter_specialist"] = TWITTER_SPECIALIST
        if "linkedin" in self.enabled_platforms:
            subagents["linkedin_specialist"] = LINKEDIN_SPECIALIST
        if "blog" in self.enabled_platforms:
            subagents["blog_specialist"] = BLOG_SPECIALIST
        if "instagram" in self.enabled_platforms:
            subagents["instagram_specialist"] = INSTAGRAM_SPECIALIST

        # Create MCP server for emit_work_output tool with context baked in
        shared_tools = create_shared_tools_server(
            basket_id=basket_id,
            work_ticket_id=work_ticket_id,
            agent_type="content"
        )

        # Build Claude SDK options with subagents and MCP server
        # NOTE: Official SDK v0.1.8+ does NOT have 'tools' parameter
        # Must use mcp_servers + allowed_tools pattern
        # Note: max_tokens is controlled at ClaudeSDKClient.chat() level, not here
        self._options = ClaudeAgentOptions(
            model=self.model,
            system_prompt=self._build_system_prompt(),
            agents=subagents,  # Native subagents!
            mcp_servers={"shared_tools": shared_tools},
            allowed_tools=["mcp__shared_tools__emit_work_output"],
        )

        logger.info(
            f"ContentAgentSDK initialized: basket={basket_id}, "
            f"ticket={work_ticket_id}, platforms={self.enabled_platforms}, "
            f"subagents={list(subagents.keys())}"
        )

    def _build_system_prompt(self) -> str:
        """Build system prompt with knowledge modules."""
        prompt = CONTENT_AGENT_SYSTEM_PROMPT

        # Add capabilities info
        prompt += f"""

**Your Capabilities**:
- Memory: Available (SubstrateMemoryAdapter)
- Enabled Platforms: {", ".join(self.enabled_platforms)}
- Brand Voice Mode: {self.brand_voice_mode}
- Session ID: {self.current_session.id}
"""

        # Inject knowledge modules if provided
        if self.knowledge_modules:
            prompt += "\n\n---\n\n# 📚 YARNNN Knowledge Modules (Procedural Knowledge)\n\n"
            prompt += "The following knowledge modules provide guidelines on how to work effectively in YARNNN:\n\n"
            prompt += self.knowledge_modules

        return prompt

    async def create(
        self,
        platform: str,
        topic: str,
        content_type: str = "post",
        requirements: Optional[str] = None,
        claude_session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create platform-specific content.

        Args:
            platform: Target platform (twitter, linkedin, blog, instagram)
            topic: Content topic
            content_type: Type of content (post, thread, article)
            requirements: Additional requirements (optional)
            claude_session_id: Optional Claude session ID to resume

        Returns:
            Content creation results with structured work_outputs:
            {
                "platform": str,
                "topic": str,
                "content_type": str,
                "work_outputs": List[dict],
                "output_count": int,
                "source_block_ids": List[str],
                "agent_type": "content",
                "claude_session_id": str  # NEW: for session continuity
            }
        """
        logger.info(f"ContentAgentSDK.create: {content_type} for {platform} - {topic}")

        if platform not in self.enabled_platforms:
            raise ValueError(
                f"Platform '{platform}' not enabled. "
                f"Enabled: {', '.join(self.enabled_platforms)}"
            )

        # Query existing knowledge for brand voice examples
        context = None
        source_block_ids = []
        if self.memory:
            memory_results = await self.memory.query(
                f"brand voice examples for {platform}",
                limit=5
            )
            context = "\n".join([r.content for r in memory_results])
            source_block_ids = [
                str(r.metadata.get("block_id", r.metadata.get("id", "")))
                for r in memory_results
                if hasattr(r, "metadata") and r.metadata
            ]
            source_block_ids = [bid for bid in source_block_ids if bid]

        # Build content creation prompt
        content_prompt = f"""Create {content_type} content for {platform}.

**Topic**: {topic}

**Brand Voice Examples (Block IDs: {source_block_ids if source_block_ids else 'none'})**:
{context or "No brand voice examples available"}

**Requirements**:
{requirements or "Standard quality and engagement"}

**Brand Voice Mode**: {self.brand_voice_mode}

**Instructions**:
1. Review brand voice examples to understand tone and style
2. Delegate to {platform}_specialist subagent for platform-specific best practices
3. Create engaging content that matches brand voice
4. Emit work_output with:
   - output_type: "content_draft"
   - title: Brief description of content
   - body: The actual content (formatted for {platform})
   - confidence: How well this matches brand voice (0.0-1.0)
   - metadata: {{platform: "{platform}", content_type: "{content_type}", topic: "{topic}"}}
   - source_block_ids: {source_block_ids}

Remember:
- Match brand voice from examples
- Optimize for {platform} best practices
- Make it engaging and authentic
- Include clear value/takeaway

Please create compelling {content_type} content for {platform} about {topic}."""

        # Execute with Claude SDK
        response_text = ""
        new_session_id = None
        work_outputs = []

        try:
            # NOTE: api_key comes from ANTHROPIC_API_KEY env var (SDK reads it automatically)
            async with ClaudeSDKClient(
                options=self._options
            ) as client:
                # Connect (resume existing session or start new)
                if claude_session_id:
                    logger.info(f"Resuming Claude session: {claude_session_id}")
                    await client.connect(session_id=claude_session_id)
                else:
                    logger.info("Starting new Claude session")
                    await client.connect()

                # Send query
                await client.query(content_prompt)

                # Collect responses and parse tool results
                async for message in client.receive_response():
                    logger.debug(f"SDK message type: {type(message).__name__}")

                    # Process content blocks
                    if hasattr(message, 'content') and isinstance(message.content, list):
                        for block in message.content:
                            if not hasattr(block, 'type'):
                                continue

                            block_type = block.type
                            logger.debug(f"SDK block type: {block_type}")

                            # Text blocks
                            if hasattr(block, 'text'):
                                response_text += block.text

                            # Tool result blocks (extract work outputs)
                            elif block_type == 'tool_result':
                                tool_name = getattr(block, 'tool_name', '')
                                logger.debug(f"Tool result from: {tool_name}")

                                if tool_name == 'emit_work_output':
                                    try:
                                        result_content = getattr(block, 'content', None)
                                        if result_content:
                                            import json
                                            if isinstance(result_content, str):
                                                output_data = json.loads(result_content)
                                            else:
                                                output_data = result_content

                                            # Convert to WorkOutput object if needed
                                            from shared.work_output_tools import WorkOutput
                                            if isinstance(output_data, dict):
                                                work_output = WorkOutput(**output_data)
                                            else:
                                                work_output = output_data
                                            work_outputs.append(work_output)
                                            logger.info(f"Captured work output: {output_data.get('title', 'untitled')}")
                                    except Exception as e:
                                        logger.error(f"Failed to parse work output: {e}", exc_info=True)

                # Get session ID from client
                new_session_id = getattr(client, 'session_id', None)
                logger.debug(f"Session ID retrieved: {new_session_id}")

        except Exception as e:
            logger.error(f"Content creation failed: {e}")
            raise

        # Log results
        logger.info(
            f"Content creation produced {len(work_outputs)} structured outputs: "
            f"{[o.output_type for o in work_outputs]}"
        )

        # Update agent session with new claude_session_id
        if new_session_id:
            self.current_session.update_claude_session(new_session_id)
            logger.info(f"Stored Claude session: {new_session_id}")

        results = {
            "platform": platform,
            "topic": topic,
            "content_type": content_type,
            "timestamp": datetime.utcnow().isoformat(),
            "work_outputs": [o.to_dict() for o in work_outputs],
            "output_count": len(work_outputs),
            "source_block_ids": source_block_ids,
            "agent_type": "content",
            "basket_id": self.basket_id,
            "work_ticket_id": self.work_ticket_id,
            "claude_session_id": new_session_id,  # NEW: for session continuity
            "response_text": response_text,  # For debugging/logging
        }

        logger.info(f"Content creation complete: {platform} {content_type} with {len(work_outputs)} outputs")

        return results


# ============================================================================
# Convenience Functions
# ============================================================================

def create_content_agent_sdk(
    basket_id: str,
    workspace_id: str,
    work_ticket_id: str,
    **kwargs
) -> ContentAgentSDK:
    """
    Convenience factory function for creating ContentAgentSDK.

    Args:
        basket_id: Basket ID for substrate queries
        workspace_id: Workspace ID for authorization
        work_ticket_id: Work ticket ID for output tracking
        **kwargs: Additional arguments for ContentAgentSDK

    Returns:
        Configured ContentAgentSDK instance
    """
    return ContentAgentSDK(
        basket_id=basket_id,
        workspace_id=workspace_id,
        work_ticket_id=work_ticket_id,
        **kwargs
    )
