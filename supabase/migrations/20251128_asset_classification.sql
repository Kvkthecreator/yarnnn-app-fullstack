-- Asset Classification Enhancement
-- Supports async LLM-powered asset classification

-- Add pending_classification type for minimal upload flow
INSERT INTO asset_type_catalog (asset_type, display_name, description, category, allowed_mime_types, notes) VALUES
  (
    'pending_classification',
    'Pending Classification',
    'Asset awaiting LLM classification - will be automatically updated',
    'system',
    ARRAY['*/*'],
    'System type for minimal upload flow. Do not select manually.'
  )
ON CONFLICT (asset_type) DO NOTHING;

-- Add classification tracking columns to reference_assets
ALTER TABLE reference_assets
ADD COLUMN IF NOT EXISTS classification_status text DEFAULT 'unclassified'
CHECK (classification_status IN ('unclassified', 'classifying', 'classified', 'failed'));

ALTER TABLE reference_assets
ADD COLUMN IF NOT EXISTS classification_confidence float;

ALTER TABLE reference_assets
ADD COLUMN IF NOT EXISTS classified_at timestamptz;

ALTER TABLE reference_assets
ADD COLUMN IF NOT EXISTS classification_metadata jsonb DEFAULT '{}';

-- Index for finding assets that need classification
CREATE INDEX IF NOT EXISTS idx_reference_assets_classification_status
ON reference_assets(classification_status)
WHERE classification_status IN ('unclassified', 'classifying');

COMMENT ON COLUMN reference_assets.classification_status IS 'LLM classification status: unclassified, classifying, classified, failed';
COMMENT ON COLUMN reference_assets.classification_confidence IS 'LLM confidence score (0-1) for the classified asset_type';
COMMENT ON COLUMN reference_assets.classified_at IS 'When classification completed';
COMMENT ON COLUMN reference_assets.classification_metadata IS 'LLM classification response metadata (alternative types, reasoning, etc.)';
