/**
 * Shared activity type constants.
 * Kept in lib/ (not in an API route file) so they can be imported by both
 * API routes and the Assessments component without triggering Next.js's
 * "route files must only export HTTP handlers" constraint.
 */
export const ACTIVITY_TYPES = [
  'Quiz', 'Test', 'Assessment', 'Assignment',
  'Midterm Exam', 'Final Exam', 'Other',
] as const;

export type ActivityType = typeof ACTIVITY_TYPES[number];
