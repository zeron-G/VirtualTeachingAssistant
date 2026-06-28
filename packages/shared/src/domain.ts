/**
 * Channel-agnostic domain types.
 *
 * Every channel adapter (Discord now; email and web later) normalizes its
 * native events into an `InboundRequest` and renders an `OutboundReply` back.
 * The core orchestrator and the governance layer only ever see these shapes —
 * they never know which channel a message came from.
 */

import type { CourseRole } from './roles.js';

/** A course is the tenant boundary. */
export type CourseId = string;
export type UserId = string;

export type ChannelKind = 'discord' | 'email' | 'web';

export interface Attachment {
  readonly kind: 'image' | 'file';
  readonly url?: string;
  readonly name?: string;
}

/**
 * One prior turn of a conversation, reconstructed by a channel adapter (e.g. the
 * last few messages in a Discord thread). `assistant` turns were already
 * egress-governed when the bot posted them; `user` turns are re-redacted for PII
 * by the core before they reach the model.
 */
export interface ConversationTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** A normalized inbound message, scoped to exactly one course. */
export interface InboundRequest {
  readonly id: string;
  readonly channel: ChannelKind;
  readonly courseId: CourseId;
  readonly userId: UserId;
  readonly role: CourseRole;
  readonly text: string;
  /** Conversation/thread key within the channel, if any. */
  readonly threadId?: string;
  /**
   * Prior turns of THIS conversation (oldest first), if the adapter could
   * reconstruct them — e.g. earlier messages in the same thread. Excludes the
   * current message (`text`). Used to give the agent follow-up context.
   */
  readonly history?: readonly ConversationTurn[];
  /** BCP-47 language hint; the assistant mirrors the student's language. */
  readonly locale?: string;
  readonly attachments?: readonly Attachment[];
  /** ISO-8601 timestamp. */
  readonly receivedAt: string;
  /** Channel-native payload — for adapter use only, never passed to the model. */
  readonly raw?: unknown;
}

/** A source the assistant grounded an answer in. Answers without citations are refused. */
export interface Citation {
  readonly sourceId: string;
  readonly title: string;
  /** Optional finer locator, e.g. "Module 3, slide 12". */
  readonly locator?: string;
}

export type ReplyStatus = 'answered' | 'refused' | 'escalated' | 'rate_limited' | 'error';

/** The assistant's response, rendered back to the originating channel by its adapter. */
export interface OutboundReply {
  readonly text: string;
  readonly status: ReplyStatus;
  readonly citations?: readonly Citation[];
  readonly threadId?: string;
}
