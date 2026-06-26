/**
 * `CourseIngestionService` — the ADMIN ingestion path.
 *
 * This is SEPARATE from the request/answering path (`TeachingService`). It is
 * what admin onboarding and periodic Canvas sync call to populate a course's
 * retrievable material; it never answers a student and never touches the
 * governance gates. Keeping it in its own service makes that boundary explicit:
 * answering reads chunks, onboarding writes them, and the two share only the
 * data layer and the embedder.
 *
 * Per-course tenancy of Canvas access: each professor brings their OWN Canvas
 * token, looked up from the {@link SecretsProvider} under the namespaced name
 * `canvas.token.<courseSlug>` (falling back to `canvas.token.<courseId>`), per
 * the `@vta/shared` secrets convention. The Canvas base URL is resolved the same
 * way (`canvas.baseUrl.<courseSlug>`), falling back to a deployment-wide default.
 */

import type { Db } from '@vta/data';
import {
  ChunkRepository,
  CourseRepository,
  MaterialRepository,
} from '@vta/data';
import type { SecretsProvider, Logger, CourseId } from '@vta/shared';
import { createLogger, NotFoundError } from '@vta/shared';
import type { RoleMapping } from '@vta/llm';
import { ModelRouter } from '@vta/llm';
import type { EmbeddingProvider, IngestStats } from '@vta/rag';
import { RagIngestor } from '@vta/rag';
import { CanvasClient } from '@vta/canvas';

/**
 * Inputs to the ingestion service. Like {@link import('./composition.js').CoreConfig}
 * it needs the `Db`, the `secrets` provider, and the active LLM `mapping` (the
 * `embed` role drives embedding). A `defaultCanvasBaseUrl` may be supplied for
 * deployments where every course shares one Canvas instance; an absent value
 * lets {@link CanvasClient} use its own default.
 */
export interface IngestionConfig {
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly mapping: RoleMapping;
  /** Optional deployment-wide Canvas base URL when no per-course override exists. */
  readonly defaultCanvasBaseUrl?: string;
  readonly logger?: Logger;
}

export class CourseIngestionService {
  private readonly db: Db;
  private readonly secrets: SecretsProvider;
  private readonly defaultCanvasBaseUrl: string | undefined;
  private readonly log: Logger;
  private readonly embedder: EmbeddingProvider;
  private readonly materialRepo: MaterialRepository;
  private readonly chunkRepo: ChunkRepository;
  private readonly courseRepo: CourseRepository;

  constructor(config: IngestionConfig) {
    this.db = config.db;
    this.secrets = config.secrets;
    this.defaultCanvasBaseUrl = config.defaultCanvasBaseUrl;
    this.log = config.logger ?? createLogger({ name: 'course-ingestion' });

    // The embedder is shared structurally with the answering path: the router's
    // `embed` role adapted to the `EmbeddingProvider` port. No model is named.
    const router = new ModelRouter({ mapping: config.mapping, secrets: config.secrets });
    this.embedder = { embed: (texts: string[]): Promise<number[][]> => router.embed(texts) };

    this.materialRepo = new MaterialRepository(this.db);
    this.chunkRepo = new ChunkRepository(this.db);
    this.courseRepo = new CourseRepository(this.db);
  }

  /**
   * Build a course-scoped {@link RagIngestor}: resolve this course's Canvas token
   * + base URL from secrets, construct a read-only {@link CanvasClient}, and pair
   * it with the shared embedder and repositories.
   *
   * @throws NotFoundError when no course exists for `courseId`.
   * @throws SecretMissingError when the course's Canvas token is not configured.
   */
  async buildIngestor(courseId: CourseId): Promise<RagIngestor> {
    const course = await this.courseRepo.getById(courseId);
    if (course === undefined) {
      throw new NotFoundError('course', courseId);
    }

    // Secrets are namespaced by the human-friendly slug (e.g. CANVAS_TOKEN_CS101
    // via the env provider's name-mangling), falling back to the opaque courseId.
    const slug = course.slug;
    const token = await this.resolveCanvasToken(slug, courseId);
    const baseUrl = await this.resolveCanvasBaseUrl(slug);

    const canvas = new CanvasClient({
      baseUrl,
      token,
      logger: this.log,
    });

    return new RagIngestor({
      canvas,
      embedder: this.embedder,
      materialRepo: this.materialRepo,
      chunkRepo: this.chunkRepo,
      logger: this.log,
    });
  }

  /**
   * Ingest one course's Canvas content end-to-end: build the course-scoped
   * ingestor, then sync pages/assignments/announcements/modules/syllabus into
   * embedded, retrievable chunks. Returns the run's {@link IngestStats}.
   *
   * @param courseId        the VTA tenant id (NOT the Canvas id).
   * @param canvasCourseId  the Canvas course id (a numeric string).
   */
  async ingestCourse(courseId: CourseId, canvasCourseId: string): Promise<IngestStats> {
    const ingestor = await this.buildIngestor(courseId);
    const stats = await ingestor.ingestCanvasCourse(courseId, canvasCourseId);
    this.log.info(
      { courseId, canvasCourseId, ...stats },
      'course ingestion complete',
    );
    return stats;
  }

  /** Resolve the per-course Canvas token, preferring the slug-keyed secret. */
  private async resolveCanvasToken(slug: string, courseId: CourseId): Promise<string> {
    const bySlug = await this.secrets.get(`canvas.token.${slug}`);
    if (bySlug !== undefined && bySlug !== '') return bySlug;
    // Fall back to the courseId-keyed name; `require` throws SecretMissingError
    // (naming the courseId variant) when neither is configured.
    return this.secrets.require(`canvas.token.${courseId}`);
  }

  /**
   * Resolve the per-course Canvas base URL: a slug-keyed secret override, else
   * the deployment-wide default, else `undefined` (CanvasClient supplies its own
   * default instance URL).
   */
  private async resolveCanvasBaseUrl(slug: string): Promise<string> {
    const override = await this.secrets.get(`canvas.baseUrl.${slug}`);
    if (override !== undefined && override !== '') return override;
    return this.defaultCanvasBaseUrl ?? '';
  }
}
