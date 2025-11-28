"use client";

import { useState, useEffect } from 'react';
import { notificationService } from '@/lib/notifications/service';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { Badge } from '@/components/ui/Badge';
import { Settings, Shield, AlertTriangle, CheckCircle2, Circle, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface GovernanceSettings {
  governance_enabled: boolean;
  validator_required: boolean;
  governance_ui_enabled: boolean;
  // Phase 2: retention controls
  retention_enabled: boolean;
  retention_policy_text: string; // JSON text for flexible policy; parsed on save
  // Simplified top-level mode: 'proposal' | 'hybrid'
  mode: 'proposal' | 'hybrid';
  entry_point_policies: {
    onboarding_dump: string;
    manual_edit: string;
  };
  default_blast_radius: string;
}

interface GovernanceSettingsClientProps {
  workspaceId: string;
  workspaceName: string;
  initialSettings: any;
  userRole: string;
  initialWorkSupervision: {
    review_strategy: 'auto' | 'manual';
  };
}

export default function GovernanceSettingsClient({ 
  workspaceId, 
  workspaceName, 
  initialSettings,
  userRole,
  initialWorkSupervision,
}: GovernanceSettingsClientProps) {
  const router = useRouter();
  const [settings, setSettings] = useState<GovernanceSettings>(() => {
    if (initialSettings) {
      return {
        governance_enabled: true,
        validator_required: false,
        governance_ui_enabled: true,
        retention_enabled: Boolean(initialSettings.retention_enabled),
        retention_policy_text: JSON.stringify(initialSettings.retention_policy || {}, null, 2),
        mode: initialSettings.ep_manual_edit === 'hybrid' ? 'hybrid' : 'proposal',
        entry_point_policies: {
          onboarding_dump: 'direct', // Canon: P0 capture must be direct
          manual_edit: initialSettings.ep_manual_edit,
        },
        default_blast_radius: initialSettings.default_blast_radius === 'Global' ? 'Scoped' : initialSettings.default_blast_radius
      };
    }
    
    // Canon-compliant defaults
    return {
      governance_enabled: true,
      validator_required: false,
      governance_ui_enabled: true,
      retention_enabled: false,
      retention_policy_text: '{\n  "dump": { "days": null },\n  "block": { "days": null },\n  "context_item": { "days": null }\n}',
      mode: 'proposal',
      entry_point_policies: {
        onboarding_dump: 'direct',
        manual_edit: 'proposal',
      },
      default_blast_radius: 'Scoped'
    };
  });

  const [loading, setLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setHasChanges(true);
  }, [settings]);


  const handleSave = async () => {
    setLoading(true);
    
    try {
      // Validate retention policy JSON
      let retentionPolicy: any = {};
      try {
        retentionPolicy = settings.retention_policy_text ? JSON.parse(settings.retention_policy_text) : {};
      } catch (e) {
        throw new Error('Retention policy JSON is invalid');
      }

      // Derive entry point policies from simplified mode
      const derivedPolicies = {
        onboarding_dump: 'direct',
        manual_edit: settings.mode,
        graph_action: 'proposal', // legacy graph ops always reviewed
        timeline_restore: 'proposal', // always reviewed per canon
      };

      const response = await fetch('/api/governance/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          governance_enabled: true,
          validator_required: false,
          governance_ui_enabled: true,
          retention_enabled: settings.retention_enabled,
          retention_policy: retentionPolicy,
          entry_point_policies: derivedPolicies,
          default_blast_radius: settings.default_blast_radius
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update settings');
      }

      notificationService.notify({
        type: 'governance.settings.changed',
        title: 'Settings Updated',
        message: 'Governance settings have been updated successfully',
        severity: 'success'
      });
      setHasChanges(false);
      
      // Refresh the page to get updated settings
      window.location.reload();
      
    } catch (error) {
      console.error('Settings update failed:', error);
      notificationService.notify({
        type: 'governance.settings.changed',
        title: 'Settings Update Failed',
        message: error instanceof Error ? error.message : 'Failed to update settings',
        severity: 'error',
        channels: ['toast', 'persistent']
      });
    } finally {
      setLoading(false);
    }
  };

  const getGovernanceStatus = () => {
    if (!settings.governance_enabled) {
      return { status: 'disabled', color: 'bg-red-100 text-red-800', icon: Circle };
    }
    // Canon: full mode when governance is enabled and validator is required (P0 always direct, direct_substrate_writes is enforced server-side)
    if (settings.governance_enabled && settings.validator_required) {
      return { status: 'full', color: 'bg-green-100 text-green-800', icon: CheckCircle2 };
    }
    if (settings.governance_enabled && settings.governance_ui_enabled) {
      return { status: 'partial', color: 'bg-yellow-100 text-yellow-800', icon: AlertTriangle };
    }
    return { status: 'testing', color: 'bg-blue-100 text-blue-800', icon: Circle };
  };

  const governanceStatus = getGovernanceStatus();
  const StatusIcon = governanceStatus.icon;
  const [workSupervision, setWorkSupervision] = useState<'auto' | 'manual'>(initialWorkSupervision.review_strategy);
  const [wsSaving, setWsSaving] = useState(false);

  const saveWorkSupervision = async () => {
    setWsSaving(true);
    try {
      const res = await fetch('/api/work-supervision/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_strategy: workSupervision }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update work supervision settings');
      }
      notificationService.notify({
        type: 'work_supervision.settings.changed',
        title: 'Work supervision updated',
        message: `Default review strategy set to ${workSupervision === 'auto' ? 'Auto-approve' : 'Manual review'}.`,
        severity: 'success',
      });
    } catch (error) {
      notificationService.notify({
        type: 'work_supervision.settings.changed',
        title: 'Update failed',
        message: error instanceof Error ? error.message : 'Failed to update work supervision',
        severity: 'error',
      });
    } finally {
      setWsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto py-8 space-y-8 max-w-4xl px-6">
        {/* Header */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => { try { router.back(); } catch { router.push('/dashboard/home'); } }}
                className="inline-flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900"
                aria-label="Go back"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Shield className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Governance Settings</h1>
                <p className="text-gray-600 text-sm">Workspace: {workspaceName}</p>
              </div>
            </div>
            <Badge className={`${governanceStatus.color} flex items-center gap-1.5`}>
              <StatusIcon className="h-3.5 w-3.5" />
              {governanceStatus.status === 'full' && 'Full Governance'}
              {governanceStatus.status === 'partial' && 'Partial Governance'}
              {governanceStatus.status === 'testing' && 'Testing Mode'}
              {governanceStatus.status === 'disabled' && 'Disabled'}
            </Badge>
          </div>
        </div>

        {/* (Removed) Content Review Controls — consolidated into Review Mode */}

        {/* Simplified Mode Controls (Substrate Governance) */}
        <Card>
          <CardHeader className="p-6">
            <CardTitle>Review Mode</CardTitle>
            <p className="text-sm text-gray-600 mt-2">
              Control how manual context edits are reviewed before landing in substrate
            </p>
          </CardHeader>
          <CardContent className="p-8 space-y-4">
            <div className="flex flex-col gap-4">
              <label className="flex items-start gap-3 p-4 rounded-lg border-2 border-gray-200 cursor-pointer hover:border-blue-300 transition-colors has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                <input
                  type="radio"
                  name="mode"
                  checked={settings.mode === 'proposal'}
                  onChange={() => setSettings(prev => ({ ...prev, mode: 'proposal' }))}
                  className="h-4 w-4 mt-0.5"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm text-gray-900">Review Everything</div>
                  <p className="text-xs text-gray-600 mt-1">
                    All manual edits to substrate go through governance review before execution. Maximum control and safety.
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3 p-4 rounded-lg border-2 border-gray-200 cursor-pointer hover:border-blue-300 transition-colors has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                <input
                  type="radio"
                  name="mode"
                  checked={settings.mode === 'hybrid'}
                  onChange={() => setSettings(prev => ({ ...prev, mode: 'hybrid' }))}
                  disabled={!settings.governance_enabled}
                  className="h-4 w-4 mt-0.5"
                />
                <div className="flex-1">
                  <div className="font-medium text-sm text-gray-900">Smart Review</div>
                  <p className="text-xs text-gray-600 mt-1">
                    High-confidence manual edits auto-approve. Low-confidence or risky edits require review. Balanced approach.
                  </p>
                </div>
              </label>
            </div>

            {/* Entry Point Policies Visibility */}
            <div className="mt-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="h-4 w-4 text-slate-600" />
                <h3 className="text-sm font-medium text-slate-900">Current Policy Routing</h3>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-slate-600">Onboarding Dumps (P0 Capture)</span>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">
                    ✓ Always Direct
                  </Badge>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-slate-600">Manual Edits (Add Context)</span>
                  <Badge variant="outline" className={settings.mode === 'hybrid' ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-yellow-50 text-yellow-700 border-yellow-300'}>
                    {settings.mode === 'hybrid' ? '⚡ Smart Review' : '⚠ Requires Review'}
                  </Badge>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-3">
                Review Mode only affects manual edits to substrate. Onboarding captures stay direct; other operations are reviewed by default.
              </p>
            </div>

            {/* Advanced Policies (optional) */}
            <details className="mt-4">
              <summary className="text-sm cursor-pointer text-slate-700 hover:text-slate-900">Advanced settings (optional)</summary>
              <div className="space-y-2 pt-3">
                <Label className="font-medium">Default Change Scope</Label>
                <select
                  value={settings.default_blast_radius === 'Global' ? 'Scoped' : settings.default_blast_radius}
                  onChange={(e) => setSettings(prev => ({
                    ...prev,
                    default_blast_radius: e.target.value
                  }))}
                  className="w-full md:w-64 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="Local">Local (single basket)</option>
                  <option value="Scoped">Scoped (workspace-wide)</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Defines the default impact radius for changes. Local affects only the current basket, Scoped can affect related content across your workspace.
                </p>
              </div>
            </details>
          </CardContent>
        </Card>

        {/* Work Supervision (Workspace default) */}
        <Card>
          <CardHeader className="p-6">
            <CardTitle>Work Supervision (Workspace Default)</CardTitle>
            <p className="text-sm text-gray-600 mt-2">
              Default review posture for work outputs across all projects in this workspace.
            </p>
          </CardHeader>
          <CardContent className="p-8 space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <button
                onClick={() => setWorkSupervision('auto')}
                className={`flex items-start gap-3 rounded-lg border-2 p-4 text-left transition ${
                  workSupervision === 'auto'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-blue-300'
                }`}
              >
                <div className="flex-1">
                  <div className="font-medium text-sm text-gray-900">Auto-approve</div>
                  <p className="text-xs text-gray-600 mt-1">
                    Work outputs are auto-approved by default. Use project-level queues to spot-check as needed.
                  </p>
                </div>
              </button>
              <button
                onClick={() => setWorkSupervision('manual')}
                className={`flex items-start gap-3 rounded-lg border-2 p-4 text-left transition ${
                  workSupervision === 'manual'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-blue-300'
                }`}
              >
                <div className="flex-1">
                  <div className="font-medium text-sm text-gray-900">Manual review required</div>
                  <p className="text-xs text-gray-600 mt-1">
                    All work outputs stay pending until explicitly approved in the review queue.
                  </p>
                </div>
              </button>
            </div>
            <div className="flex justify-end">
              <Button onClick={saveWorkSupervision} disabled={wsSaving}>
                {wsSaving ? 'Saving…' : 'Save Work Supervision'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Retention Policy (removed from user UI per canon; developer‑level) */}

        {/* Save Controls */}
        <div className="flex items-center justify-between p-6 bg-white rounded-lg border border-gray-200">
          <div className="flex items-center gap-2">
            <button
              onClick={() => { try { router.back(); } catch { router.push('/baskets'); } }}
              className="inline-flex items-center gap-1 text-sm text-gray-700 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          </div>
          
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              onClick={() => window.location.reload()}
              disabled={loading}
            >
              Reset
            </Button>
            <Button 
              onClick={handleSave}
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}

function getEntryPointDescription(entryPoint: string): string {
  switch (entryPoint) {
    case 'onboarding_dump': return 'Initial content capture from new users';
    case 'manual_edit': return 'Direct editing of substrate (Add Meaning, etc.)';
    default: return 'Substrate modification action';
  }
}
