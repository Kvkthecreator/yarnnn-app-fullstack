/**
 * Chat Cards - In-chat display components for Chat-First Architecture
 *
 * These components render rich displays within TP chat messages:
 * - Context changes (single and grouped)
 * - Work outputs (single and carousel)
 * - Recipe progress (with execution steps)
 *
 * Part of Chat-First Architecture v1.0
 * See: /docs/architecture/CHAT_FIRST_ARCHITECTURE_V1.md
 */

export { ContextChangeCard } from './ContextChangeCard';
export { ContextChangesGroup } from './ContextChangesGroup';
export { WorkOutputCard, WorkOutputCarousel } from './WorkOutputCard';
export { RecipeProgressCard, ExecutionStepsTimeline } from './RecipeProgressCard';
