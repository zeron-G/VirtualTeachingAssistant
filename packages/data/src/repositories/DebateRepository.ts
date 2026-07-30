import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import {
  debateJudgements,
  debateParticipants,
  debateSessions,
  debateTurns,
} from "../schema/debate.js";
import type {
  DebateJudgementRow,
  DebateParticipantRow,
  DebateSessionRow,
  DebateTurnRow,
  NewDebateJudgementRow,
  NewDebateParticipantRow,
  NewDebateSessionRow,
  NewDebateTurnRow,
} from "../schema/debate.js";

/** A session plus everything a client needs to render it. */
export interface DebateSnapshot {
  readonly session: DebateSessionRow;
  readonly participants: DebateParticipantRow[];
  readonly turns: DebateTurnRow[];
  readonly judgement: DebateJudgementRow | undefined;
}

/**
 * Course-scoped access to the classroom debate tables.
 *
 * Phase transitions use OPTIMISTIC CONCURRENCY on `phase_seq` so a
 * double-tapped professor button, a duplicate timer, or a transient second
 * replica are all idempotent: the losing write simply matches no row.
 */
export class DebateRepository {
  constructor(private readonly db: Db) {}

  /* ---------------------------------------------------------------- sessions */

  async createSession(input: NewDebateSessionRow): Promise<DebateSessionRow> {
    const rows = await this.db.insert(debateSessions).values(input).returning();
    const row = rows[0];
    if (row === undefined) throw new Error("createSession: expected a returned row");
    return row;
  }

  async getSession(id: string): Promise<DebateSessionRow | undefined> {
    const rows = await this.db
      .select()
      .from(debateSessions)
      .where(eq(debateSessions.id, id))
      .limit(1);
    return rows[0];
  }

  /** Look a session up by its human-typed join code. Only joinable while not ended. */
  async getSessionByJoinCode(joinCode: string): Promise<DebateSessionRow | undefined> {
    const rows = await this.db
      .select()
      .from(debateSessions)
      .where(eq(debateSessions.joinCode, joinCode.toUpperCase()))
      .limit(1);
    return rows[0];
  }

  /** Most recent sessions for a course (professor console list). */
  async listSessions(courseId: string, limit = 20): Promise<DebateSessionRow[]> {
    return this.db
      .select()
      .from(debateSessions)
      .where(eq(debateSessions.courseId, courseId))
      .orderBy(sql`${debateSessions.createdAt} desc`)
      .limit(limit);
  }

  /**
   * Apply a phase/status/floor change, guarded by the caller's expected
   * `phaseSeq`. Returns the updated row, or `undefined` if another writer won.
   */
  async updateSessionState(
    id: string,
    expectedPhaseSeq: number,
    patch: {
      phase?: string;
      status?: string;
      phaseEndsAt?: Date | null;
      floorParticipantId?: string | null;
      endedAt?: Date | null;
    },
  ): Promise<DebateSessionRow | undefined> {
    const rows = await this.db
      .update(debateSessions)
      .set({ ...patch, phaseSeq: expectedPhaseSeq + 1 })
      .where(and(eq(debateSessions.id, id), eq(debateSessions.phaseSeq, expectedPhaseSeq)))
      .returning();
    return rows[0];
  }

  /* ------------------------------------------------------------ participants */

  async addParticipant(input: NewDebateParticipantRow): Promise<DebateParticipantRow> {
    const rows = await this.db.insert(debateParticipants).values(input).returning();
    const row = rows[0];
    if (row === undefined) throw new Error("addParticipant: expected a returned row");
    return row;
  }

  async getParticipant(id: string): Promise<DebateParticipantRow | undefined> {
    const rows = await this.db
      .select()
      .from(debateParticipants)
      .where(eq(debateParticipants.id, id))
      .limit(1);
    return rows[0];
  }

  /** Resume an existing seat after a refresh / reconnect. */
  async findParticipantByDevice(
    sessionId: string,
    deviceId: string,
  ): Promise<DebateParticipantRow | undefined> {
    const rows = await this.db
      .select()
      .from(debateParticipants)
      .where(
        and(
          eq(debateParticipants.sessionId, sessionId),
          eq(debateParticipants.deviceId, deviceId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async listParticipants(sessionId: string): Promise<DebateParticipantRow[]> {
    return this.db
      .select()
      .from(debateParticipants)
      .where(eq(debateParticipants.sessionId, sessionId))
      .orderBy(asc(debateParticipants.joinedAt));
  }

  async updateParticipant(
    id: string,
    patch: { displayName?: string; team?: string; consentAt?: Date | null },
  ): Promise<DebateParticipantRow | undefined> {
    const rows = await this.db
      .update(debateParticipants)
      .set(patch)
      .where(eq(debateParticipants.id, id))
      .returning();
    return rows[0];
  }

  /* ------------------------------------------------------------------ turns */

  async addTurn(input: NewDebateTurnRow): Promise<DebateTurnRow> {
    const rows = await this.db.insert(debateTurns).values(input).returning();
    const row = rows[0];
    if (row === undefined) throw new Error("addTurn: expected a returned row");
    return row;
  }

  async listTurns(sessionId: string, since?: Date): Promise<DebateTurnRow[]> {
    const where =
      since === undefined
        ? eq(debateTurns.sessionId, sessionId)
        : and(eq(debateTurns.sessionId, sessionId), gt(debateTurns.createdAt, since));
    return this.db.select().from(debateTurns).where(where).orderBy(asc(debateTurns.createdAt));
  }

  /* ------------------------------------------------------------- judgements */

  async addJudgement(input: NewDebateJudgementRow): Promise<DebateJudgementRow> {
    const rows = await this.db.insert(debateJudgements).values(input).returning();
    const row = rows[0];
    if (row === undefined) throw new Error("addJudgement: expected a returned row");
    return row;
  }

  /** The newest verdict for a session, if any. */
  async latestJudgement(sessionId: string): Promise<DebateJudgementRow | undefined> {
    const rows = await this.db
      .select()
      .from(debateJudgements)
      .where(eq(debateJudgements.sessionId, sessionId))
      .orderBy(sql`${debateJudgements.createdAt} desc`)
      .limit(1);
    return rows[0];
  }

  /** Professor confirms (or overrides) an advisory AI verdict. */
  async confirmJudgement(id: string, confirmedBy: string): Promise<void> {
    await this.db
      .update(debateJudgements)
      .set({ isFinal: true, confirmedBy })
      .where(eq(debateJudgements.id, id));
  }

  /* --------------------------------------------------------------- snapshot */

  /** Everything the professor console / student room needs in one round trip. */
  async snapshot(sessionId: string): Promise<DebateSnapshot | undefined> {
    const session = await this.getSession(sessionId);
    if (session === undefined) return undefined;
    const [participants, turns, judgement] = await Promise.all([
      this.listParticipants(sessionId),
      this.listTurns(sessionId),
      this.latestJudgement(sessionId),
    ]);
    return { session, participants, turns, judgement };
  }
}
