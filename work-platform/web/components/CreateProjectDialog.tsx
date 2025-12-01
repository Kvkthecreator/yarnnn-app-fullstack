"use client";

import { useMemo, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/Textarea';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Loader2, Sparkles, ChevronDown, ChevronUp, Upload, FileText, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Supported file types for seed materials
const SUPPORTED_SEED_FILE_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'text/plain',
  'text/markdown',
];
const MAX_SEED_FILE_SIZE = 10 * 1024 * 1024; // 10MB

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CreateProjectDialog({ open, onOpenChange }: CreateProjectDialogProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectIntent, setProjectIntent] = useState('');
  const [description, setDescription] = useState('');
  const [seedFile, setSeedFile] = useState<File | null>(null);
  const [showSeedUpload, setShowSeedUpload] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const canSubmit = useMemo(() => {
    return projectName.trim().length > 0 && projectIntent.trim().length > 0;
  }, [projectName, projectIntent]);

  const resetState = () => {
    setProjectName('');
    setProjectIntent('');
    setDescription('');
    setSeedFile(null);
    setShowSeedUpload(false);
    setDragOver(false);
    setError(null);
    setSubmitting(false);
    setSuccess(false);
  };

  // File handling
  const validateFile = (file: File): string | null => {
    if (!SUPPORTED_SEED_FILE_TYPES.includes(file.type)) {
      return 'Unsupported file type. Please upload PDF, DOCX, PPTX, TXT, or MD files.';
    }
    if (file.size > MAX_SEED_FILE_SIZE) {
      return 'File too large. Maximum size is 10MB.';
    }
    return null;
  };

  const handleFileSelect = useCallback((file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSeedFile(file);
    setError(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const removeFile = useCallback(() => {
    setSeedFile(null);
  }, []);

  const handleClose = (nextOpen: boolean) => {
    if (submitting) return;
    onOpenChange(nextOpen);
    if (!nextOpen) resetState();
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      // Use FormData if we have a file, otherwise JSON
      let response: Response;

      if (seedFile) {
        const formData = new FormData();
        formData.append('project_name', projectName.trim());
        formData.append('project_intent', projectIntent.trim());
        if (description.trim()) {
          formData.append('description', description.trim());
        }
        formData.append('seed_file', seedFile);

        response = await fetch('/api/projects/new', {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await fetch('/api/projects/new', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            project_name: projectName.trim(),
            project_intent: projectIntent.trim(),
            description: description.trim() || undefined,
          }),
        });
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Failed to create project' }));
        throw new Error(typeof errorData.detail === 'string' ? errorData.detail : errorData.detail?.message || 'Failed to create project');
      }

      const result = await response.json();

      setSuccess(true);
      handleClose(false);
      resetState();

      // Navigate to project context page
      router.push(`/projects/${result.project_id}/context`);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create project';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription>
            Create a project workspace. You'll set up foundational context on the next screen.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-4">
            <FieldBlock label="Project Name" required>
              <Input
                placeholder="e.g., Healthcare AI Research"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                autoFocus
                maxLength={200}
              />
            </FieldBlock>

            <FieldBlock label="What are you trying to achieve?" required hint="One sentence describing your goal">
              <Input
                placeholder="e.g., Build a diagnostic tool for radiologists"
                value={projectIntent}
                onChange={(e) => setProjectIntent(e.target.value)}
                maxLength={300}
              />
            </FieldBlock>

            <FieldBlock label="Description" hint="Optional · Brief summary visible on project cards">
              <Textarea
                placeholder="What is this project about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="resize-none"
                maxLength={1000}
              />
            </FieldBlock>

            {/* Collapsible file upload for seed materials */}
            <div className="border-t pt-4">
              <button
                type="button"
                onClick={() => setShowSeedUpload(!showSeedUpload)}
                className="flex w-full items-center justify-between text-sm font-medium text-slate-700 hover:text-slate-900"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  <span>Seed from existing materials</span>
                  <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                </div>
                {showSeedUpload ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>

              {showSeedUpload && (
                <div className="mt-3 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Upload a pitch deck, PRD, research notes, or other existing materials.
                    AI will extract context and generate additional foundational blocks.
                  </p>

                  {seedFile ? (
                    // File selected - show preview
                    <div className="flex items-center gap-3 p-3 border rounded-lg bg-slate-50">
                      <FileText className="h-8 w-8 text-slate-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {seedFile.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(seedFile.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={removeFile}
                        className="h-8 w-8 p-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    // Dropzone
                    <div
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      className={cn(
                        "border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer",
                        dragOver
                          ? "border-primary bg-primary/5"
                          : "border-slate-200 hover:border-slate-300"
                      )}
                      onClick={() => document.getElementById('seed-file-input')?.click()}
                    >
                      <Upload className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                      <p className="text-sm text-slate-600 mb-1">
                        Drop a file here, or click to browse
                      </p>
                      <p className="text-xs text-muted-foreground">
                        PDF, DOCX, PPTX, TXT, MD · Max 10MB
                      </p>
                      <input
                        id="seed-file-input"
                        type="file"
                        accept=".pdf,.docx,.pptx,.txt,.md"
                        onChange={handleFileInputChange}
                        className="hidden"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {error && (
            <div className="flex items-center gap-2 rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              <span>Project created successfully. Redirecting…</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleClose(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit || submitting}>
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating…
              </span>
            ) : (
              'Create Project'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldBlock({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <Label className={cn('text-sm font-medium text-slate-800', required && 'after:ml-0.5 after:text-destructive after:content-["*"]')}>
          {label}
        </Label>
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
