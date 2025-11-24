"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Badge } from "@/components/ui/Badge";
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import Link from "next/link";

interface RecipeParameter {
  type: string;
  label: string;
  required: boolean;
  placeholder?: string;
  default?: any;
  min?: number;
  max?: number;
  options?: string[];
}

interface Recipe {
  id: string;
  name: string;
  description: string;
  agent_type: string;
  output_format: string;
  parameters: Record<string, RecipeParameter>;
}

interface RecipeConfigureClientProps {
  projectId: string;
  basketId: string;
  workspaceId: string;
  recipe: Recipe;
}

export default function RecipeConfigureClient({
  projectId,
  basketId,
  workspaceId,
  recipe,
}: RecipeConfigureClientProps) {
  const router = useRouter();
  const [formValues, setFormValues] = useState<Record<string, any>>(() => {
    // Initialize with defaults
    const initial: Record<string, any> = {};
    Object.entries(recipe.parameters).forEach(([key, param]) => {
      if (param.default !== undefined) {
        initial[key] = param.default;
      }
    });
    return initial;
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (key: string, value: any) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      // Build task description from form values
      const topic = formValues.topic || "Work request";
      const taskDescription = `${topic}\n\nRecipe: ${recipe.name}\nParameters: ${JSON.stringify(formValues, null, 2)}`;

      // Call appropriate specialist endpoint based on agent type
      let endpoint = "";
      let requestBody: any = {
        basket_id: basketId,
        task_description: taskDescription,
        output_format: recipe.output_format,
        priority: 5,
      };

      switch (recipe.agent_type) {
        case "reporting":
          endpoint = "/api/work/reporting/execute";
          break;
        case "research":
          endpoint = "/api/work/research/execute";
          break;
        case "content":
          endpoint = "/api/work/content/execute";
          break;
        default:
          throw new Error(`Unknown agent type: ${recipe.agent_type}`);
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      const result = await response.json();

      // Redirect to work ticket detail page
      if (result.work_ticket_id) {
        router.push(`/projects/${projectId}/work-tickets/${result.work_ticket_id}`);
      } else {
        throw new Error("No work_ticket_id in response");
      }
    } catch (err: any) {
      console.error("Recipe execution failed:", err);
      setError(err.message || "Failed to execute recipe");
      setSubmitting(false);
    }
  };

  const canSubmit = () => {
    // Check all required parameters are filled
    return Object.entries(recipe.parameters).every(([key, param]) => {
      if (!param.required) return true;
      const value = formValues[key];
      if (param.type === "multitext") {
        return Array.isArray(value) && value.length > 0;
      }
      return value !== undefined && value !== null && value !== "";
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div className="space-y-2">
        <Link
          href={`/projects/${projectId}/work-tickets/new`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Recipe Gallery
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{recipe.name}</h1>
            <p className="text-muted-foreground mt-1">{recipe.description}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Badge variant="outline" className="capitalize">{recipe.agent_type} Agent</Badge>
            <Badge variant="secondary" className="uppercase">{recipe.output_format}</Badge>
          </div>
        </div>
      </div>

      {/* Configuration Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="p-6">
          <h2 className="text-xl font-semibold text-foreground mb-4">Recipe Configuration</h2>
          <div className="space-y-4">
            {Object.entries(recipe.parameters).map(([key, param]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={key}>
                  {param.label}
                  {param.required && <span className="text-destructive ml-1">*</span>}
                </Label>

                {param.type === "text" && (
                  <Input
                    id={key}
                    type="text"
                    value={formValues[key] || ""}
                    onChange={(e) => handleInputChange(key, e.target.value)}
                    placeholder={param.placeholder}
                    required={param.required}
                  />
                )}

                {param.type === "number" && (
                  <Input
                    id={key}
                    type="number"
                    value={formValues[key] || param.default || ""}
                    onChange={(e) => handleInputChange(key, parseInt(e.target.value))}
                    min={param.min}
                    max={param.max}
                    required={param.required}
                  />
                )}

                {param.type === "select" && (
                  <select
                    id={key}
                    value={formValues[key] || param.default || ""}
                    onChange={(e) => handleInputChange(key, e.target.value)}
                    required={param.required}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {param.options?.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                )}

                {param.type === "multitext" && (
                  <Textarea
                    id={key}
                    value={(formValues[key] || param.default || []).join("\n")}
                    onChange={(e) => handleInputChange(key, e.target.value.split("\n").filter(Boolean))}
                    placeholder="Enter one item per line"
                    rows={4}
                    required={param.required}
                  />
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Error Display */}
        {error && (
          <Card className="p-4 border-destructive bg-destructive/5">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Execution Failed</h3>
                <p className="text-sm text-muted-foreground mt-1">{error}</p>
              </div>
            </div>
          </Card>
        )}

        {/* Submit Button */}
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/projects/${projectId}/work-tickets/new`)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!canSubmit() || submitting}
            className="min-w-[140px]"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Execute Recipe
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
