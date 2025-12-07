'use client';

/**
 * RecipesWindowContent
 *
 * Content for the Recipes floating window.
 * Displays available work recipes that TP can trigger.
 *
 * Part of Desktop UI Architecture v1.0
 * See: /docs/implementation/DESKTOP_UI_IMPLEMENTATION_PLAN.md
 */

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  Loader2,
  Target,
  Search,
  Zap,
  FileText,
  TrendingUp,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useBasketId } from '../DesktopProvider';

// ============================================================================
// Types
// ============================================================================

interface Recipe {
  slug: string;
  name: string;
  description?: string;
  category: string;
  agent_type: string;
  context_required?: string[];
  estimated_duration?: string;
}

// ============================================================================
// Constants
// ============================================================================

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  research: Search,
  content: Pencil,
  reporting: FileText,
  analysis: TrendingUp,
  default: Target,
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  research: { bg: 'bg-blue-50', text: 'text-blue-700' },
  content: { bg: 'bg-green-50', text: 'text-green-700' },
  reporting: { bg: 'bg-purple-50', text: 'text-purple-700' },
  analysis: { bg: 'bg-amber-50', text: 'text-amber-700' },
  default: { bg: 'bg-gray-50', text: 'text-gray-700' },
};

// ============================================================================
// Component
// ============================================================================

export function RecipesWindowContent() {
  const basketId = useBasketId();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  // Fetch recipes
  const fetchRecipes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // TODO: Replace with actual API endpoint
      const response = await fetch(`/api/recipes`);
      if (!response.ok) {
        // Use mock data if API not available
        setRecipes(MOCK_RECIPES);
        return;
      }
      const data = await response.json();
      setRecipes(data.recipes || data || MOCK_RECIPES);
    } catch (err) {
      console.error('Failed to fetch recipes:', err);
      // Fall back to mock data
      setRecipes(MOCK_RECIPES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecipes();
  }, [fetchRecipes]);

  // Get unique categories
  const categories = [...new Set(recipes.map((r) => r.category))];

  // Filter recipes
  const filteredRecipes = recipes.filter((recipe) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (
        !recipe.name.toLowerCase().includes(query) &&
        !recipe.description?.toLowerCase().includes(query) &&
        !recipe.slug.toLowerCase().includes(query)
      ) {
        return false;
      }
    }
    if (filterCategory && recipe.category !== filterCategory) {
      return false;
    }
    return true;
  });

  // Group by category
  const groupedRecipes = filteredRecipes.reduce<Record<string, Recipe[]>>(
    (acc, recipe) => {
      const category = recipe.category || 'other';
      if (!acc[category]) acc[category] = [];
      acc[category].push(recipe);
      return acc;
    },
    {}
  );

  return (
    <div className="flex h-full flex-col">
      {/* Search and Filter */}
      <div className="border-b border-border p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search recipes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-input bg-background py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {categories.map((category) => {
            const colors = CATEGORY_COLORS[category] || CATEGORY_COLORS.default;
            const isActive = filterCategory === category;
            return (
              <button
                key={category}
                onClick={() => setFilterCategory(isActive ? null : category)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                  isActive
                    ? `${colors.bg} ${colors.text} border border-current/20`
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}
              >
                {category}
              </button>
            );
          })}
          {filterCategory && (
            <button
              onClick={() => setFilterCategory(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Recipes List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={fetchRecipes}>
              Retry
            </Button>
          </div>
        ) : filteredRecipes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <Target className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-sm font-medium">No recipes found</p>
            <p className="text-xs text-muted-foreground mt-1">
              Try adjusting your search
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {Object.entries(groupedRecipes).map(([category, categoryRecipes]) => (
              <div key={category}>
                <div
                  className={cn(
                    'px-4 py-2 text-xs font-medium capitalize',
                    CATEGORY_COLORS[category]?.bg || 'bg-muted',
                    CATEGORY_COLORS[category]?.text || 'text-muted-foreground'
                  )}
                >
                  {category} ({categoryRecipes.length})
                </div>
                {categoryRecipes.map((recipe) => (
                  <RecipeRow key={recipe.slug} recipe={recipe} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        <p>Ask TP to trigger any recipe by name</p>
      </div>
    </div>
  );
}

// ============================================================================
// Recipe Row
// ============================================================================

interface RecipeRowProps {
  recipe: Recipe;
}

function RecipeRow({ recipe }: RecipeRowProps) {
  const colors = CATEGORY_COLORS[recipe.category] || CATEGORY_COLORS.default;
  const Icon = CATEGORY_ICONS[recipe.category] || CATEGORY_ICONS.default;

  return (
    <div className="p-4 hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-3">
        <div className={cn('rounded-md p-2', colors.bg)}>
          <Icon className={cn('h-4 w-4', colors.text)} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{recipe.name}</span>
            <Badge variant="outline" className="text-xs">
              {recipe.agent_type}
            </Badge>
          </div>

          {recipe.description && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {recipe.description}
            </p>
          )}

          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
              {recipe.slug}
            </code>
            {recipe.estimated_duration && (
              <>
                <span>·</span>
                <span>~{recipe.estimated_duration}</span>
              </>
            )}
          </div>

          {recipe.context_required && recipe.context_required.length > 0 && (
            <div className="mt-2 flex items-center gap-1 flex-wrap">
              <span className="text-xs text-muted-foreground">Requires:</span>
              {recipe.context_required.map((ctx) => (
                <Badge key={ctx} variant="secondary" className="text-[10px]">
                  {ctx}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Mock Data
// ============================================================================

const MOCK_RECIPES: Recipe[] = [
  {
    slug: 'research.deep_dive',
    name: 'Deep Research',
    description: 'Comprehensive research on a topic with web search and analysis',
    category: 'research',
    agent_type: 'research',
    context_required: ['customer', 'problem'],
    estimated_duration: '5-10 min',
  },
  {
    slug: 'research.competitor_analysis',
    name: 'Competitor Analysis',
    description: 'Analyze competitors in your market space',
    category: 'research',
    agent_type: 'research',
    context_required: ['customer', 'problem'],
    estimated_duration: '5-10 min',
  },
  {
    slug: 'content.blog_post',
    name: 'Blog Post',
    description: 'Generate a blog post based on your context',
    category: 'content',
    agent_type: 'content',
    context_required: ['brand', 'customer'],
    estimated_duration: '3-5 min',
  },
  {
    slug: 'content.social_media',
    name: 'Social Media Posts',
    description: 'Create social media content for multiple platforms',
    category: 'content',
    agent_type: 'content',
    context_required: ['brand'],
    estimated_duration: '2-3 min',
  },
  {
    slug: 'reporting.executive_summary',
    name: 'Executive Summary',
    description: 'Generate an executive summary from research outputs',
    category: 'reporting',
    agent_type: 'reporting',
    context_required: ['vision'],
    estimated_duration: '3-5 min',
  },
];

export default RecipesWindowContent;
