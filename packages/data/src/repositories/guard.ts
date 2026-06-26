import { TenantMismatchError } from "@vta/shared";
import type { CourseId } from "@vta/shared";

/**
 * Tenant-isolation guard. Throws `TenantMismatchError` when a value that is
 * supposed to belong to `expected` course actually belongs to `actual`.
 *
 * Use this anywhere a repository accepts a `courseId` AND an entity that itself
 * carries a `courseId` (e.g. a material id resolved to a row), so a caller can
 * never read or mutate another course's data by passing a mismatched pair.
 *
 * @param expected the course the caller is scoped to.
 * @param actual   the course the touched entity actually belongs to.
 */
export function guardCourse(expected: CourseId, actual: CourseId): void {
  if (expected !== actual) {
    throw new TenantMismatchError(expected, actual);
  }
}
