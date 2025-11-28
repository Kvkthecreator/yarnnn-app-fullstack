"""
Asset Classification Service - LLM-powered asset type detection

Analyzes uploaded files and determines the best asset_type from the catalog.
Uses the same OpenAI integration pattern as anchor_seeding.py.

Architecture: Async classification after minimal upload
1. User uploads file with minimal metadata
2. Classification runs in background
3. User notified via app_events when complete
"""

import json
import logging
import os
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from openai import OpenAI

logger = logging.getLogger("uvicorn.error")

# LLM Configuration (same pattern as anchor_seeding.py)
MODEL_CLASSIFY = os.getenv("LLM_MODEL_CLASSIFY", "gpt-4o-mini")
TEMP_CLASSIFY = float(os.getenv("LLM_TEMP_CLASSIFY", "0.2"))
MAX_TOKENS_CLASSIFY = int(os.getenv("LLM_MAX_TOKENS_CLASSIFY", "1000"))


# ============================================================================
# Classification Prompts
# ============================================================================

CLASSIFICATION_SYSTEM_PROMPT = """You are an expert at classifying business files and documents for a work context platform.

Given a file's metadata (name, MIME type, size) and optionally a text preview, determine the best asset type from the catalog.

ASSET TYPES (in order of specificity):
- brand_voice_sample: Example content showing desired brand voice/tone (marketing copy samples, social posts)
- competitor_screenshot: Screenshots of competitor products, marketing, websites
- tone_reference_doc: Style guides, brand guidelines, voice documentation (PDFs, docs)
- watchlist_json: JSON configuration for monitoring (domains, keywords)
- template_file: Report templates, content templates, output format specs
- data_source: External data files (CSVs, spreadsheets, data exports)
- other: Only if nothing else fits

RULES:
1. Be specific - prefer specific types over "other"
2. Consider MIME type strongly (images → screenshots likely, JSON → watchlist likely)
3. Consider file name patterns (guide, template, sample, competitor, etc.)
4. Provide confidence 0-1 (0.8+ = confident, 0.5-0.8 = reasonable guess, <0.5 = uncertain)
5. Suggest an appropriate description based on file name

Return JSON with: asset_type, confidence, description, reasoning"""

CLASSIFICATION_USER_TEMPLATE = """Classify this uploaded file:

File name: {file_name}
MIME type: {mime_type}
File size: {file_size_bytes} bytes
{text_preview_section}

Return JSON with these exact fields:
{{
  "asset_type": "one of the valid types",
  "confidence": 0.0-1.0,
  "description": "brief description for the asset",
  "reasoning": "why this classification"
}}"""


# ============================================================================
# Classification Service
# ============================================================================

class AssetClassificationService:
    """Service for LLM-powered asset classification."""

    @staticmethod
    async def classify_asset(
        file_name: str,
        mime_type: str,
        file_size_bytes: int,
        text_preview: Optional[str] = None,
        available_types: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Classify an asset using LLM.

        Args:
            file_name: Original file name
            mime_type: MIME type of the file
            file_size_bytes: File size in bytes
            text_preview: Optional text preview (first ~500 chars for text files)
            available_types: Optional list of valid asset types from catalog

        Returns:
            Dict with: asset_type, confidence, description, reasoning, success
        """
        if not os.getenv("OPENAI_API_KEY"):
            logger.error("[ASSET CLASSIFY] OPENAI_API_KEY not set")
            return {
                "success": False,
                "asset_type": "other",
                "confidence": 0.0,
                "description": file_name,
                "reasoning": "LLM configuration error",
            }

        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

        # Build preview section
        text_preview_section = ""
        if text_preview:
            text_preview_section = f"\nText preview (first 500 chars):\n{text_preview[:500]}"

        user_prompt = CLASSIFICATION_USER_TEMPLATE.format(
            file_name=file_name,
            mime_type=mime_type or "unknown",
            file_size_bytes=file_size_bytes,
            text_preview_section=text_preview_section,
        )

        # Retry logic for reliability
        for attempt in range(3):
            try:
                response = client.chat.completions.create(
                    model=MODEL_CLASSIFY,
                    messages=[
                        {"role": "system", "content": CLASSIFICATION_SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt}
                    ],
                    temperature=TEMP_CLASSIFY,
                    max_completion_tokens=MAX_TOKENS_CLASSIFY,
                    response_format={"type": "json_object"},
                )

                raw_response = response.choices[0].message.content
                logger.debug(f"[ASSET CLASSIFY] LLM response: {raw_response}")

                data = json.loads(raw_response)

                # Validate asset_type is in catalog (if available_types provided)
                asset_type = data.get("asset_type", "other")
                if available_types and asset_type not in available_types:
                    logger.warning(f"[ASSET CLASSIFY] LLM suggested invalid type: {asset_type}, falling back to 'other'")
                    asset_type = "other"

                return {
                    "success": True,
                    "asset_type": asset_type,
                    "confidence": min(1.0, max(0.0, float(data.get("confidence", 0.5)))),
                    "description": data.get("description", file_name),
                    "reasoning": data.get("reasoning", ""),
                }

            except json.JSONDecodeError as e:
                logger.warning(f"[ASSET CLASSIFY] JSON parse error (attempt {attempt + 1}): {e}")
                if attempt == 2:
                    break
                time.sleep(0.5 * (attempt + 1))

            except Exception as e:
                logger.warning(f"[ASSET CLASSIFY] LLM error (attempt {attempt + 1}): {e}")
                if attempt == 2:
                    break
                time.sleep(0.5 * (attempt + 1))

        # Fallback response
        return {
            "success": False,
            "asset_type": "other",
            "confidence": 0.0,
            "description": file_name,
            "reasoning": "Classification failed after retries",
        }

    @staticmethod
    def get_text_preview(file_content: bytes, mime_type: str) -> Optional[str]:
        """
        Extract text preview from file content for classification context.

        Only for text-based files (text/*, application/json, etc.)
        """
        if not mime_type:
            return None

        # Text-based MIME types we can preview
        text_types = [
            "text/",
            "application/json",
            "application/xml",
            "application/javascript",
        ]

        is_text = any(mime_type.startswith(t) for t in text_types)
        if not is_text:
            return None

        try:
            # Try UTF-8 first, then latin-1 as fallback
            try:
                text = file_content[:2000].decode("utf-8")
            except UnicodeDecodeError:
                text = file_content[:2000].decode("latin-1")

            # Clean up for LLM context
            return text[:500]

        except Exception as e:
            logger.debug(f"[ASSET CLASSIFY] Could not extract text preview: {e}")
            return None


# Global instance
classification_service = AssetClassificationService()
