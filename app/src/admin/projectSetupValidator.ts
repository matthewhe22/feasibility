/**
 * Pure validator extracted from ProjectSetupPage so unit tests can exercise it
 * without React state or Vite/Supabase init paths.
 *
 * Returns null when the name is acceptable; otherwise a human-readable error.
 */
export function validateProjectName(name: string, existing: readonly string[]): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Project name cannot be empty.';
  if (trimmed.length > 50) return `Project name is too long — max 50 characters (got ${trimmed.length}).`;
  if (existing.some(p => p.toLowerCase() === trimmed.toLowerCase())) {
    return `"${trimmed}" is already in the master list.`;
  }
  return null;
}
