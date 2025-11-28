import type { Database } from '@/lib/dbTypes';
import type { TimelineEventDTO, TimelineEventKind, TimelineEventSignificance } from './types';

type TimelineRow = Database['public']['Tables']['timeline_events']['Row'];

function mapKind(kind: string, preview?: string | null): TimelineEventKind {
  const k = kind.toLowerCase();
  const summary = (preview || '').toLowerCase();
  if (k.startsWith('dump')) return 'capture';
  if (k.startsWith('proposal') || k === 'queue.entry_created') return 'proposal';
  if (k === 'proposal.approved' || k === 'proposal.rejected' || k === 'delta.applied' || k === 'delta.rejected') {
    return 'proposal_resolved';
  }
  if (k.startsWith('document.') && k.endsWith('deleted')) return 'document_deleted';
  if (k.startsWith('document.') || k.includes('narrative')) return 'document';
  if (k.includes('reflection') || k.includes('insight')) return 'insight';
  if (
    k.startsWith('block.') ||
    k.startsWith('context_item.') ||
    k.startsWith('relationship.') ||
    k.startsWith('substrate.') ||
    k === 'timeline_event.attached' ||
    k === 'timeline_event.detached'
  ) {
    return 'block';
  }
  if (k.startsWith('work.') || k.startsWith('pipeline.') || k.startsWith('cascade.')) return 'automation';

  if (summary.includes('p0_capture')) return 'capture';
  if (summary.includes('p1_substrate') || summary.includes('p2_graph')) return 'block';
  if (summary.includes('p3_reflection')) return 'insight';
  if (summary.includes('p4_compose')) return 'document';

  return 'system';
}

function inferSignificance(kind: TimelineEventKind): TimelineEventSignificance {
  switch (kind) {
    case 'capture':
    case 'proposal':
    case 'proposal_resolved':
    case 'document':
    case 'document_deleted':
      return 'high';
    case 'insight':
    case 'automation':
      return 'medium';
    case 'block':
    case 'system':
    default:
      return 'low';
  }
}

function createTitle(kind: TimelineEventKind, row: TimelineRow): string {
  const summary = row.preview || '';
  switch (kind) {
    case 'capture':
      return 'Memory capture added';
    case 'proposal':
      return 'Change request submitted';
    case 'proposal_resolved':
      if (row.kind === 'proposal.approved' || row.kind === 'delta.applied') return 'Change request approved';
      if (row.kind === 'proposal.rejected' || row.kind === 'delta.rejected') return 'Change request rejected';
      return 'Change request resolved';
    case 'document':
      if (row.kind === 'document.updated') return 'Document updated';
      if (row.kind === 'document.block.attached' || row.kind === 'document.block.detached') return 'Document links updated';
      if (row.kind === 'document.narrative.authored') return 'Narrative authored';
      if (row.kind === 'document.composed') return 'Document composed';
      return 'Document event';
    case 'document_deleted':
      return 'Document deleted';
    case 'insight':
      return 'Insight refreshed';
    case 'block':
      if (row.kind === 'block.created') return 'Knowledge block created';
      if (row.kind === 'block.updated') return 'Knowledge block updated';
      if (row.kind === 'block.state_changed') return 'Block state changed';
      return 'Knowledge block update';
    case 'automation':
      if (row.kind === 'work.completed' || row.kind === 'pipeline.cascade_completed' || row.kind === 'cascade.completed') {
        return 'Automation completed';
      }
      if (row.kind?.includes('failed')) {
        return 'Automation failed';
      }
      return 'Automation activity';
    case 'system':
    default:
      return summary || 'System event';
  }
}

function createDescription(kind: TimelineEventKind, row: TimelineRow): string | undefined {
  const payload = row.payload as Record<string, any> | null;
  switch (kind) {
    case 'capture': {
      const sourceType = payload?.source_type || payload?.ingest_type || 'manual entry';
      return `Captured via ${sourceType}.`;
    }
    case 'proposal': {
      const items = payload?.items_applied ?? payload?.operations_count;
      if (items) return `Contains ${items} proposed change${items === 1 ? '' : 's'}.`;
      return row.preview || 'Awaiting review.';
    }
    case 'proposal_resolved':
      return row.preview || undefined;
    case 'document': {
      if (payload?.document_title) return `"${payload.document_title}" was updated.`;
      if (row.preview) return row.preview;
      return undefined;
    }
    case 'document_deleted':
      return row.preview || undefined;
    case 'insight':
      return row.preview || 'Insight refreshed to reflect the latest knowledge.';
    case 'block': {
      const blockType = payload?.semantic_type;
      if (blockType) {
        return `Block type: ${blockType}.`;
      }
      return row.preview || undefined;
    }
    case 'automation':
      return row.preview || undefined;
    case 'system':
    default:
      return row.preview || undefined;
  }
}

function createLink(kind: TimelineEventKind, row: TimelineRow): { href?: string; label?: string } {
  const payload = row.payload as Record<string, any> | null;
  const basketPath = row.basket_id ? `/baskets/${row.basket_id}` : null;
  switch (kind) {
    case 'capture':
      if (!basketPath) return {};
      const dumpId = payload?.dump_id || row.ref_id;
      const highlight = dumpId ? `&highlight=${dumpId}` : '';
      return {
        href: `${basketPath}/timeline?view=uploads${highlight}`,
        label: 'View capture',
      };
    case 'proposal':
    case 'proposal_resolved':
      return {};
    case 'document':
    case 'document_deleted':
      if (payload?.document_id || row.ref_id) {
        return { href: `/documents/${payload?.document_id || row.ref_id}`, label: 'Open document' };
      }
      return { href: '/documents', label: 'Documents' };
    case 'insight':
      if (payload?.document_id) {
        return { href: `/documents/${payload.document_id}?tab=insights`, label: 'View insights' };
      }
      return {};
    case 'block':
      if (!basketPath) return {};
      const blockId = payload?.block_id || row.ref_id;
      const focus = blockId ? `?focus=${blockId}` : '';
      return { href: `${basketPath}/building-blocks${focus}`, label: 'View block' };
    case 'automation':
      if (payload?.work_id) {
        return { href: `/work/${payload.work_id}`, label: 'View run' };
      }
      return {};
    case 'system':
    default:
      return {};
  }
}

function createTags(kind: TimelineEventKind, row: TimelineRow): TimelineEventDTO['tags'] | undefined {
  const payload = row.payload as Record<string, any> | null;
  const tags: { label: string; tone?: 'info' | 'warn' | 'danger' }[] = [];

  if (kind === 'proposal' || kind === 'proposal_resolved') {
    if (payload?.origin === 'agent') tags.push({ label: 'AI suggested', tone: 'info' });
    if (payload?.origin === 'human') tags.push({ label: 'Manual', tone: 'info' });
  }

  if (kind === 'automation') {
    if (row.kind?.includes('failed')) tags.push({ label: 'Failed', tone: 'danger' });
    if (payload?.work_type) tags.push({ label: payload.work_type });
  }

  if (kind === 'capture') {
    const source = payload?.ingest_type || payload?.source_type;
    if (source) tags.push({ label: source });
  }

  return tags.length ? tags : undefined;
}

function randomId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export function transformTimelineEvent(row: TimelineRow): TimelineEventDTO {
  const kind = mapKind(row.kind || '', row.preview || '');
  const significance = inferSignificance(kind);
  const title = createTitle(kind, row);
  const description = createDescription(kind, row);
  const link = createLink(kind, row);
  const tags = createTags(kind, row);

  return {
    id: row.id ? String(row.id) : row.ref_id || randomId(),
    kind,
    title,
    description,
    timestamp: row.ts || new Date().toISOString(),
    significance,
    host: row.source_host || undefined,
    tags,
    linkHref: link.href,
    linkLabel: link.label,
  };
}

export function transformTimeline(rows: TimelineRow[]): TimelineEventDTO[] {
  return rows.map((row) => transformTimelineEvent(row));
}
