import type { Db } from "../client.js";
import { auditLog } from "../schema/audit.js";
import type { AuditLogRow, NewAuditLogRow } from "../schema/audit.js";

/**
 * Append-only writer for the FERPA §99.32-style disclosure log.
 *
 * The caller is responsible for redacting PII from `question`/`answer` BEFORE
 * calling `append` — this repository persists exactly what it is given. The log
 * is append-only by contract; no update/delete methods are exposed.
 */
export class AuditRepository {
  constructor(private readonly db: Db) {}

  /**
   * Persist one audit entry. `entry.question`/`entry.answer` must already be
   * redacted. Returns the stored row (including its generated id/timestamp).
   */
  async append(entry: NewAuditLogRow): Promise<AuditLogRow> {
    const rows = await this.db.insert(auditLog).values(entry).returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error("AuditRepository.append: expected a returned row");
    }
    return row;
  }
}
