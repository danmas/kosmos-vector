-- Migration: Add link types for Markdown document structure
-- Adds link_type entries for hierarchical and sequential relations in MD files

-- Markdown hierarchical inclusion (parent includes children)
INSERT INTO kosmos.link_type (code, label, description, is_active)
VALUES 
  ('md_includes', 'Includes', 'MD parent section includes child sections (mdDoc->H1, H1->H2)', true),
  ('md_included_in', 'Included in', 'MD child section is included in parent (H2->H1, H1->mdDoc)', true),
  ('md_follows', 'Follows', 'MD section follows another section (H2[i] follows H2[i-1])', true),
  ('md_precedes', 'Precedes', 'MD section precedes another section (H2[i-1] precedes H2[i])', true)
ON CONFLICT (code) DO NOTHING;

-- Verify
SELECT code, label, description FROM kosmos.link_type WHERE code LIKE 'md_%' ORDER BY code;
