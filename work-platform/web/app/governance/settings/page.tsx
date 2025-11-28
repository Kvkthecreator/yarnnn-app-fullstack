export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getAuthenticatedUser } from '@/lib/auth/getAuthenticatedUser';
import { ensureWorkspaceForUser } from '@/lib/workspaces/ensureWorkspaceForUser';
import { notFound } from 'next/navigation';
import GovernanceSettingsClient from './GovernanceSettingsClient';

export const metadata: Metadata = {
  title: 'Review Settings',
  description: 'Configure when content changes need approval',
};

export default async function GovernanceSettingsPage() {
  try {
    const supabase = createServerSupabaseClient();
    const { userId } = await getAuthenticatedUser(supabase);
    const workspace = await ensureWorkspaceForUser(userId, supabase);

    // Check if user is workspace owner (Canon compliant)
    const { data: membership, error: membershipError } = await supabase
      .from('workspace_memberships')
      .select('role')
      .eq('workspace_id', workspace.id)
      .eq('user_id', userId)
      .single();

    if (membershipError) {
      console.error('Workspace membership query failed:', membershipError);
      notFound();
    }
    
    if (!membership || membership.role !== 'owner') {
      console.warn('Governance settings access denied:', { 
        userId, 
        workspaceId: workspace.id, 
        role: membership?.role 
      });
      notFound();
    }

    // Get current governance settings
    const { data: settings } = await supabase
      .from('workspace_governance_settings')
      .select('*')
      .eq('workspace_id', workspace.id)
      .single();

    // Get work supervision defaults (workspace-level)
    const { data: workSupervision } = await supabase
      .from('workspace_work_supervision_settings')
      .select('*')
      .eq('workspace_id', workspace.id)
      .maybeSingle();

    return (
      <GovernanceSettingsClient 
        workspaceId={workspace.id}
        workspaceName="My Workspace"
        initialSettings={settings}
        userRole={membership.role}
        initialWorkSupervision={{
          review_strategy: workSupervision?.review_strategy || 'auto',
        }}
      />
    );
  } catch (error) {
    console.error('Governance settings page error:', error);
    notFound();
  }
}
