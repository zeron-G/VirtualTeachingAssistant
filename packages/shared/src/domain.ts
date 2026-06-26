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
