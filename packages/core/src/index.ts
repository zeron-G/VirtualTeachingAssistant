/**
 * `@vta/core` — the channel-agnostic orchestrator that ties the whole Virtual
 * Teaching Assistant together.
 *
 * Two paths, deliberately separated:
 *   - REQUEST path: {@link TeachingService} runs every inbound request through
 *     the fixed governed pipeline (load config → ingress → agent → egress →
 *     audit). {@link createTeachingService} is the composition root that wires
 *     the concrete implementations.
 *   - ADMIN path: {@link CourseIngestionService} syncs a course's Canvas content
 *     into retrievable chunks. It NEVER answers a student and shares no code path
 *     with answering.
 */

// Request path: the orchestrator + its config-loader type.
export { TeachingService } from './teachingService.js';
export type { TeachingServiceDeps, ConfigLoader } from './teachingService.js';

// Composition root for the request path.
export { createTeachingService } from './composition.js';
export type { CoreConfig } from './composition.js';

// The egress judge adapter (guard.judge model behind the LlmJudge port).
export { routerJudge } from './llmJudge.js';

// Admin ingestion path (onboarding / Canvas sync).
export { CourseIngestionService } from './ingestionService.js';
export type { IngestionConfig } from './ingestionService.js';
