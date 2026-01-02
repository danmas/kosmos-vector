// packages/core/fileMatchUtils.js
// Common utilities for file pattern matching
// Used in /api/project/tree and step1Runner.js to ensure identical logic

const { Minimatch } = require('minimatch');

/**
 * Creates matchers from configuration
 * @param {string} includeMask - Glob pattern for including files
 * @param {string} ignorePatterns - Ignore patterns (comma-separated)
 * @returns {object} Object with includeMatcher and ignoreMatchers
 */
function createMatchers(includeMask, ignorePatterns) {
  const includeMatcher = new Minimatch(includeMask || '**/*', { dot: true });
  
  // Parse ignore patterns and expand directory patterns
  // For pattern like **/data/** also add **/data to match the directory itself
  const rawPatterns = (ignorePatterns || '')
    .split(',')
    .map(p => p.trim())
    .filter(p => p);
  
  const expandedPatterns = [];
  for (const pattern of rawPatterns) {
    expandedPatterns.push(pattern);
    // If pattern ends with /** (directory contents), also add pattern for directory itself
    if (pattern.endsWith('/**')) {
      const dirPattern = pattern.slice(0, -3); // Remove /**
      if (dirPattern && !expandedPatterns.includes(dirPattern)) {
        expandedPatterns.push(dirPattern);
      }
    }
  }
  
  const ignoreMatchers = expandedPatterns.map(p => new Minimatch(p, { dot: true }));
  
  return { includeMatcher, ignoreMatchers };
}

/**
 * Normalizes relative path for UI (ensures ./ prefix, / as separator)
 * @param {string} relPath - Relative path
 * @returns {string} Normalized path with ./ prefix
 */
function normalizeRelativePathForUI(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  return normalized.startsWith('./') ? normalized : './' + normalized;
}

/**
 * Normalizes relative path for matching (removes ./ prefix for Minimatch compatibility)
 * Minimatch with pattern like ** /xxx does not match paths like ./xxx
 * @param {string} relPath - Relative path
 * @returns {string} Normalized path without ./ prefix
 */
function normalizeRelativePath(relPath) {
  let normalized = relPath.replace(/\\/g, '/');
  // Remove ./ prefix for correct Minimatch behavior
  if (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }
  return normalized;
}

/**
 * Checks if file is ignored
 * @param {string} relativePath - Relative path to file
 * @param {Array<Minimatch>} ignoreMatchers - Array of ignore matchers
 * @returns {boolean} true if file is ignored
 */
function isIgnored(relativePath, ignoreMatchers) {
  const normalized = normalizeRelativePath(relativePath);
  return ignoreMatchers.some(m => m.match(normalized));
}

/**
 * Checks if file matches include mask
 * @param {string} relativePath - Relative path to file
 * @param {Minimatch} includeMatcher - Include matcher
 * @returns {boolean} true if file matches mask
 */
function isIncluded(relativePath, includeMatcher) {
  const normalized = normalizeRelativePath(relativePath);
  return includeMatcher.match(normalized);
}

module.exports = { createMatchers, normalizeRelativePath, normalizeRelativePathForUI, isIgnored, isIncluded };
