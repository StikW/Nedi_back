import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CourseService } from '../course.service';
import { StudentService } from '../student.service';
import { ModuleProgressService } from '../module-progress.service';
import { CourseModuleService } from '../course-module.service';
import { LlmService, AgentTool, ChatTurn } from './llm.service';
import { RagService } from './rag.service';
import { QuestionsService } from './questions.service';
import { AgentStateService } from './agent-state.service';
import { EvolutionService } from './evolution.service';
import { TenantContext, IntentRoute } from './agent.types';
import { AgentState } from '../../models/agent-state.entity';
import { CourseModule } from '../../models/course-module.entity';
import {
  CLASSIFIER_PROMPT,
  CONVERSACION_INICIAL_PROMPT,
  CONVERSACION_PROMPT,
  NO_ACTIVE_COURSES_MESSAGE,
  RESPUESTAS_PROMPT,
  EXPLICAR_PROMPT,
  RESUMEN_PROMPT,
} from './prompts';
import { MediaService } from './media.service';
import { UploadsService } from '../uploads.service';
import { ModuleQuestion } from '../../models/course-module-questions.entity';

export interface RuntimeContext {
  tenant: TenantContext;
  phoneNumber: string;
  /** JID completo para responder por Evolution */
  recipientJid?: string;
  state: AgentState;
  message: string;
  history: ChatTurn[];
}

/**
 * Implementa los agentes del flujo (clasificador + sub-agentes) como funciones
 * con tool-calling. Reemplaza los nodos `agent` de n8n y sus tools.
 */
@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly courseService: CourseService,
    private readonly studentService: StudentService,
    private readonly moduleProgressService: ModuleProgressService,
    private readonly courseModuleService: CourseModuleService,
    private readonly llm: LlmService,
    private readonly rag: RagService,
    private readonly questions: QuestionsService,
    private readonly agentState: AgentStateService,
    private readonly evolution: EvolutionService,
    private readonly media: MediaService,
    private readonly uploads: UploadsService,
  ) {}

  // ===================================================================
  //  Conversacion inicial (primera interaccion / sesion vacia en n8n)
  // ===================================================================

  async runConversacionInicial(ctx: RuntimeContext): Promise<string> {
    await this.recordWelcomeSession(ctx);

    if (this.isCourseListIntent(ctx.message)) {
      const courses = await this.getStudentCourses(ctx);
      return courses.length === 0
        ? NO_ACTIVE_COURSES_MESSAGE
        : this.formatCourseList(courses);
    }

    const courses = await this.getStudentCourses(ctx);
    if (courses.length === 0) {
      return NO_ACTIVE_COURSES_MESSAGE;
    }

    return this.llm.runAgent({
      system: CONVERSACION_INICIAL_PROMPT,
      userMessage: ctx.message,
      history: [],
    });
  }

  /** Suma loginCount al entrar al agente de bienvenida (primer contacto o sesión expirada). */
  private async recordWelcomeSession(ctx: RuntimeContext): Promise<void> {
    try {
      const updated = await this.studentService.incrementLoginCount(
        ctx.phoneNumber,
        ctx.tenant.instructor.id,
      );
      if (updated > 0) {
        this.logger.log(
          `loginCount +1 para ${ctx.phoneNumber} (${updated} matrícula(s), instructor ${ctx.tenant.instructor.id})`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `No se pudo incrementar loginCount para ${ctx.phoneNumber}: ${err?.message || err}`,
      );
    }
  }

  async classify(ctx: RuntimeContext): Promise<IntentRoute> {
    if (ctx.state.offeredNextModuleId && this.wantsToStartModuleQuestions(ctx.message)) {
      return 'AI_Preguntas';
    }

    if (ctx.state.awaitingCourseStartConfirmation && this.wantsToStartModuleQuestions(ctx.message)) {
      return 'AI_Preguntas';
    }

    if (
      ctx.state.courseId &&
      !ctx.state.moduleId &&
      ctx.state.flujo !== 'preguntas' &&
      !ctx.state.lastQuestion &&
      !ctx.state.awaitingPostAnswerAction &&
      this.wantsToStartModuleQuestions(ctx.message) &&
      this.lastAssistantAskedToStartQuestions(ctx.history)
    ) {
      return 'AI_Preguntas';
    }

    if (ctx.state.awaitingModuleStartConfirmation && this.wantsToStartModuleQuestions(ctx.message)) {
      return 'AI_Preguntas';
    }

    if (ctx.state.awaitingPostAnswerAction) {
      const postAnswerRoute = this.classifyPostAnswerAction(ctx.message);
      if (postAnswerRoute) return postAnswerRoute;
    }

    const context = [
      `Estado de flujo actual: ${ctx.state.flujo}`,
      ctx.state.awaitingPostAnswerAction
        ? 'El estudiante acaba de recibir retroalimentación de su respuesta y debe elegir si quiere más explicación o la siguiente pregunta. No trates su mensaje como una nueva respuesta a la pregunta anterior.'
        : '',
      ctx.state.awaitingModuleStartConfirmation
        ? 'Ya se envió el video intro del módulo. El estudiante debe confirmar (sí/listo/comenzar/empezar) para recibir la primera pregunta.'
        : '',
      ctx.state.awaitingCourseStartConfirmation
        ? 'Se acaba de seleccionar un curso y se preguntó si quiere empezar con las preguntas. Afirmaciones como "sí", "dale" o "empecemos" deben ir a AI_Preguntas.'
        : '',
      ctx.state.lastQuestion ? `Última pregunta mostrada: ${ctx.state.lastQuestion}` : 'No hay pregunta activa.',
      ctx.state.offeredNextModuleId
        ? 'Se ofreció al estudiante continuar con el siguiente módulo del curso.'
        : '',
      `Mensaje del estudiante: ${ctx.message}`,
    ]
      .filter(Boolean)
      .join('\n');

    const raw = (await this.llm.complete(CLASSIFIER_PROMPT, context)).trim();
    const normalized = raw.replace(/[^A-Za-z_]/g, '');
    const valid: IntentRoute[] = ['AI_Conversacion', 'AI_Preguntas', 'AI_Respuestas', 'AI_Explicar'];
    const match = valid.find((v) => normalized.includes(v));
    return match || 'AI_Conversacion';
  }

  // ===================================================================
  //  Agente de Conversacion
  // ===================================================================

  async runConversacion(ctx: RuntimeContext): Promise<string> {
    const courses = await this.getStudentCourses(ctx);

    ctx.state = await this.agentState.upsertState(
      ctx.tenant.evolution.instance,
      ctx.phoneNumber,
      ctx.tenant.instructor.id,
      {
        flujo: 'conversacion',
        ...(courses.length === 0
          ? { courseId: undefined, moduleId: undefined }
          : {}),
      },
    );

    if (this.isCourseListIntent(ctx.message)) {
      return courses.length === 0
        ? NO_ACTIVE_COURSES_MESSAGE
        : this.formatCourseList(courses);
    }

    if (courses.length === 0) {
      return NO_ACTIVE_COURSES_MESSAGE;
    }

    const titles = JSON.stringify(courses.map((c) => c.title));
    const withIds = JSON.stringify(courses.map((c) => ({ id: c.id, titulo: c.title })));

    const introAlreadyDone = ctx.state.nediIntroShown || ctx.history.length > 0;
    const introGuard = introAlreadyDone
      ? '\n\n## Contexto de sesión\nEl estudiante ya recibió el mensaje de bienvenida donde Nedi se presentó. NO vuelvas a presentarte ni saludes con "Soy Nedi". Ve directo al contenido útil.'
      : '';

    const system =
      CONVERSACION_PROMPT.replace('{{coursesTitles}}', titles).replace(
        '{{coursesWithIds}}',
        withIds,
      ) + introGuard;

    const tools: AgentTool[] = [
      {
        name: 'save_courseid',
        description:
          'Guarda el curso seleccionado por el estudiante (courseId UUID) y deja el flujo en estado "conversacion".',
        parameters: {
          type: 'object',
          properties: { courseId: { type: 'string', description: 'UUID del curso seleccionado' } },
          required: ['courseId'],
        },
        execute: async (args) => {
          const courseId = args.courseId;
          const valid = courses.find((c) => c.id === courseId);
          if (!valid) return 'courseId no válido para este estudiante';
          ctx.state = await this.agentState.upsertState(
            ctx.tenant.evolution.instance,
            ctx.phoneNumber,
            ctx.tenant.instructor.id,
            {
              courseId,
              flujo: 'conversacion',
              moduleId: undefined,
              awaitingCourseStartConfirmation: true,
            },
          );
          return `Curso "${valid.title}" guardado correctamente.`;
        },
      },
    ];

    return this.llm.runAgent({
      system,
      userMessage: ctx.message,
      history: ctx.history,
      tools,
    });
  }

  // ===================================================================
  //  Agente de Preguntas
  // ===================================================================

  async runPreguntas(ctx: RuntimeContext): Promise<string> {
    const courseId = ctx.state.courseId;
    if (!courseId) {
      return 'Primero elige un curso para comenzar con las preguntas. ¿Cuál de tus cursos te gustaría iniciar?';
    }

    let moduleId = ctx.state.moduleId;
    let activeModule: CourseModule | null = null;
    if (!moduleId) {
      activeModule = await this.questions.resolveCurrentModule(courseId, ctx.phoneNumber);
      if (!activeModule) {
        return '¡Felicidades! Has completado todos los módulos disponibles de este curso. 🎉';
      }
      moduleId = activeModule.id;
    }

    ctx.state = await this.agentState.upsertState(
      ctx.tenant.evolution.instance,
      ctx.phoneNumber,
      ctx.tenant.instructor.id,
      {
        flujo: 'preguntas',
        moduleId,
        offeredNextModuleId: undefined,
        awaitingPostAnswerAction: false,
        awaitingCourseStartConfirmation: false,
      },
    );

    // Obtener o generar banco de preguntas
    let current = await this.questions.getCurrentQuestion(courseId, moduleId, ctx.phoneNumber);
    if (current.state === 'empty') {
      const { questions: generated, noDocument, extractFailed } = await this.questions.generateQuestions(
        courseId,
        moduleId,
      );
      if (generated.length === 0) {
        if (extractFailed) {
          return (
            'Encontré el documento del módulo pero no pude leerlo. ' +
            'Pide a tu instructor que vuelva a subir el PDF desde el panel e intenta de nuevo.'
          );
        }
        if (noDocument) {
          return (
            'Este módulo aún no tiene un documento PDF cargado, así que no puedo generar preguntas. ' +
            'Pide a tu instructor que suba el material del módulo desde el panel y vuelve a intentarlo.'
          );
        }
        return 'No fue posible generar preguntas con el material disponible. Intenta más tarde.';
      }
      current = await this.questions.getCurrentQuestion(courseId, moduleId, ctx.phoneNumber);
    }

    if (current.state === 'finished') {
      await this.moduleProgressService.completeModule({
        phoneNumber: ctx.phoneNumber,
        moduleId,
        courseId,
      });
      const nextModule = await this.questions.resolveCurrentModule(courseId, ctx.phoneNumber);
      const reply = await this.buildModuleCompletedMessage(moduleId, nextModule);
      ctx.state = await this.agentState.upsertState(
        ctx.tenant.evolution.instance,
        ctx.phoneNumber,
        ctx.tenant.instructor.id,
        {
          flujo: 'conversacion',
          moduleId: undefined,
          lastQuestion: undefined,
          offeredNextModuleId: nextModule?.id,
          introShownForModuleId: undefined,
          awaitingPostAnswerAction: false,
          awaitingModuleStartConfirmation: false,
          awaitingCourseStartConfirmation: false,
        },
      );
      return reply;
    }

    if (current.state !== 'question') {
      return 'No hay preguntas disponibles en este momento.';
    }

    if (current.index > 0 && ctx.state.awaitingModuleStartConfirmation) {
      ctx.state = await this.agentState.upsertState(
        ctx.tenant.evolution.instance,
        ctx.phoneNumber,
        ctx.tenant.instructor.id,
        { awaitingModuleStartConfirmation: false },
      );
    }

    // En la pregunta 1 (índice 0): video intro opcional + confirmación si hace falta.
    if (current.index === 0) {
      const confirmingStart = this.wantsToStartModuleQuestions(ctx.message);
      const awaitingIntro = ctx.state.awaitingModuleStartConfirmation;

      if (awaitingIntro && !confirmingStart) {
        return (
          'Cuando estés listo para la primera pregunta, escribe *sí*, *listo*, *comenzar* o *empezar*.'
        );
      }

      if (awaitingIntro && confirmingStart) {
        ctx.state = await this.agentState.upsertState(
          ctx.tenant.evolution.instance,
          ctx.phoneNumber,
          ctx.tenant.instructor.id,
          { awaitingModuleStartConfirmation: false },
        );
      } else if (!awaitingIntro) {
        const moduleForIntro = activeModule || (await this.courseModuleService.findOne(moduleId));
        const introSent = await this.sendModuleIntro(ctx, moduleForIntro);

        if (introSent && !confirmingStart) {
          ctx.state = await this.agentState.upsertState(
            ctx.tenant.evolution.instance,
            ctx.phoneNumber,
            ctx.tenant.instructor.id,
            { awaitingModuleStartConfirmation: true },
          );
          return (
            'Perfecto. Revisa el video con calma. Cuando quieras empezar con las preguntas, ' +
            'escribe *sí*, *listo*, *comenzar* o *empezar*.'
          );
        }

        if (!introSent && !confirmingStart) {
          ctx.state = await this.agentState.upsertState(
            ctx.tenant.evolution.instance,
            ctx.phoneNumber,
            ctx.tenant.instructor.id,
            { awaitingModuleStartConfirmation: true },
          );
          return (
            'Cuando estés listo para la primera pregunta, escribe *sí*, *listo*, *comenzar* o *empezar*.'
          );
        }

        // El estudiante ya confirmó (p. ej. "sí"): continuar sin pedir otra confirmación.
        ctx.state = await this.agentState.upsertState(
          ctx.tenant.evolution.instance,
          ctx.phoneNumber,
          ctx.tenant.instructor.id,
          { awaitingModuleStartConfirmation: false },
        );
      }
    }

    const questionText = this.formatQuestion(current.question, current.index, current.total);

    // Agente Resumen -> TTS -> audio, luego la pregunta en texto (flujo n8n)
    await this.sendResumenAudio(ctx, current.question, current.index, current.total, courseId, moduleId);

    await this.refreshLastQuestion(ctx, courseId, moduleId, questionText);
    return questionText;
  }

  // ===================================================================
  //  Agente de Respuestas
  // ===================================================================

  async runRespuestas(ctx: RuntimeContext): Promise<string> {
    const courseId = ctx.state.courseId;
    const moduleId = ctx.state.moduleId;

    const tools: AgentTool[] = [
      this.ragTool(
        'vector_validation',
        'Obtiene material de referencia del módulo para validar la respuesta del estudiante.',
        ctx,
        courseId,
        moduleId,
      ),
    ];

    const userMessage = ctx.state.lastQuestion
      ? `Pregunta: ${ctx.state.lastQuestion}\nRespuesta del estudiante: ${ctx.message}`
      : ctx.message;

    const answer = await this.llm.runAgent({
      system: RESPUESTAS_PROMPT,
      userMessage,
      history: ctx.history,
      tools,
    });

    // Avanzar indice; lastQuestion se conserva (la pregunta respondida) para explicaciones
    if (courseId && moduleId) {
      await this.agentState.advanceQuestion(ctx.phoneNumber, moduleId, courseId);
    }
    ctx.state = await this.agentState.upsertState(
      ctx.tenant.evolution.instance,
      ctx.phoneNumber,
      ctx.tenant.instructor.id,
      { awaitingPostAnswerAction: true },
    );
    return this.sanitizeFeedback(answer);
  }

  // ===================================================================
  //  Agente de Explicacion
  // ===================================================================

  async runExplicar(ctx: RuntimeContext): Promise<string> {
    const courseId = ctx.state.courseId;
    const moduleId = ctx.state.moduleId;

    const questionContext = ctx.state.lastQuestion || '';
    const tools: AgentTool[] = [
      this.ragTool(
        'vector_explain',
        'Obtiene material del módulo para explicar el concepto relacionado a la pregunta.',
        ctx,
        courseId,
        moduleId,
        questionContext || ctx.message,
      ),
    ];

    const userMessage = questionContext
      ? `Pregunta que el estudiante acaba de responder o sobre la que pide aclaración:\n${questionContext}\n\nMensaje del estudiante: ${ctx.message}`
      : ctx.message;

    const raw = await this.llm.runAgent({
      system: EXPLICAR_PROMPT,
      userMessage,
      history: ctx.history,
      tools,
    });

    ctx.state = await this.agentState.upsertState(
      ctx.tenant.evolution.instance,
      ctx.phoneNumber,
      ctx.tenant.instructor.id,
      { awaitingPostAnswerAction: true },
    );

    return this.sanitizeExplanation(raw);
  }

  // ===================================================================
  //  Helpers
  // ===================================================================

  /**
   * Intro del modulo (sub-workflow sendVideo en n8n):
   * Si `content` existe, se envia como video (Drive, Catbox, S3, etc.).
   * Solo sin URL de video: TTS con titulo + descripcion (modulos solo PDF).
   */
  private async sendModuleIntro(ctx: RuntimeContext, module: CourseModule | null): Promise<boolean> {
    if (!module) return false;
    const to = this.replyTo(ctx);
    const rawContent = (module.content || '').trim();
    if (!rawContent) return false;

    try {
      const mediaUrl = await this.resolveModuleContentUrl(module);
      if (!mediaUrl) return false;

      if (this.isYoutubeUrl(mediaUrl)) {
        await this.evolution.sendText(
          ctx.tenant.evolution,
          to,
          `${this.buildModuleVideoCaption(module)}\n\n${mediaUrl}`,
        );
        return true;
      }
      if (this.isImageUrl(mediaUrl)) {
        await this.evolution.sendMedia(ctx.tenant.evolution, to, mediaUrl, {
          mediatype: 'image',
          caption: module.title || '',
        });
        return true;
      }
      if (this.isDocumentUrl(mediaUrl)) {
        const introText = [module.title, module.description].filter(Boolean).join('. ');
        if (!introText) return false;
        const audio = await this.media.textToSpeechBase64(introText.slice(0, 4000));
        if (!audio) return false;
        await this.evolution.sendAudio(ctx.tenant.evolution, to, audio);
        return true;
      }

      const probe = await this.probeVideoUrl(mediaUrl);
      if (!probe.ok) {
        this.logger.warn(
          `URL de video no parece válida moduleId=${module.id} type=${probe.contentType} size=${probe.size}`,
        );
        const base64 = await this.fetchVideoAsBase64(mediaUrl);
        if (base64) {
          await this.evolution.sendMedia(ctx.tenant.evolution, to, base64, {
            mediatype: 'video',
            caption: this.buildModuleVideoCaption(module),
            fileName: `video-${module.id}.mp4`,
            mimetype: 'video/mp4',
            delay: 2000,
          });
          this.logger.log(`Video de modulo enviado como base64 moduleId=${module.id}`);
          return true;
        }
        await this.sendModuleIntroAsTextLink(ctx, module, mediaUrl);
        return true;
      }

      try {
        await this.evolution.sendVideo(ctx.tenant.evolution, to, mediaUrl, {
          caption: this.buildModuleVideoCaption(module),
          fileName: `video-${module.id}.mp4`,
        });
        this.logger.log(`Video de modulo enviado moduleId=${module.id}`);
        return true;
      } catch (sendErr: any) {
        this.logger.warn(
          `sendVideo fallo moduleId=${module.id}, intentando base64: ${sendErr?.message || sendErr}`,
        );
        const base64 = await this.fetchVideoAsBase64(mediaUrl);
        if (base64) {
          await this.evolution.sendMedia(ctx.tenant.evolution, to, base64, {
            mediatype: 'video',
            caption: this.buildModuleVideoCaption(module),
            fileName: `video-${module.id}.mp4`,
            mimetype: 'video/mp4',
            delay: 2000,
          });
          this.logger.log(`Video de modulo enviado como base64 (fallback) moduleId=${module.id}`);
          return true;
        }
        await this.sendModuleIntroAsTextLink(ctx, module, mediaUrl);
        return true;
      }
    } catch (err: any) {
      this.logger.warn(`No se pudo enviar intro del modulo ${module.id}: ${err?.message || err}`);
      return false;
    }
  }

  private async sendModuleIntroAsTextLink(
    ctx: RuntimeContext,
    module: CourseModule,
    mediaUrl: string,
  ): Promise<void> {
    await this.evolution.sendText(
      ctx.tenant.evolution,
      this.replyTo(ctx),
      `${this.buildModuleVideoCaption(module)}\n\nNo pude reproducir el video aquí. Ábrelo con este enlace:\n${mediaUrl}`,
      1200,
      { linkPreview: true },
    );
  }

  /**
   * Caption del video: solo contexto del módulo. La invitación a escribir
   * listo/comenzar va en el mensaje de texto que sigue al video.
   */
  private buildModuleVideoCaption(module: CourseModule): string {
    const title = module.title?.trim() || 'este módulo';
    const orderLabel = module.order ? `Módulo ${module.order}` : 'Nuevo módulo';
    const teaser = this.shortModuleTeaser(module.description);
    const lines = [`*${orderLabel}: ${title}*`];

    if (teaser) {
      lines.push('', teaser);
    }

    return lines.join('\n');
  }

  private shortModuleTeaser(description?: string): string {
    if (!description?.trim()) return '';

    const clean = description.trim().replace(/\s+/g, ' ');
    const parts = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
    const candidates = parts.length > 0 ? parts : [clean];

    for (const raw of candidates) {
      let sentence = raw.trim().replace(/^\d+\.\s*/, '').trim();
      // Evita viñetas sueltas tipo "1." que quedan al parsear listas numeradas.
      if (!sentence || /^\d+\.?$/.test(sentence) || sentence.length < 4) {
        continue;
      }
      return sentence.length > 140 ? `${sentence.slice(0, 137)}...` : sentence;
    }

    return '';
  }

  private async resolveModuleContentUrl(module: CourseModule): Promise<string | null> {
    const raw = (module.content || '').trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return this.normalizeVideoUrl(raw);

    const key = raw.replace(/^\//, '');
    const fullKey = key.startsWith('courses/')
      ? key
      : `courses/${module.courseId}/modules/${module.id}/${key.split('/').pop() || key}`;
    try {
      return await this.uploads.getModuleDownloadUrl(module.courseId, module.id, fullKey, 3600);
    } catch {
      return `${this.uploads.getModulesPublicBaseUrl()}/${fullKey}`;
    }
  }

  /** Convierte enlaces de Google Drive compartidos a descarga directa. */
  private normalizeVideoUrl(url: string): string {
    const trimmed = url.trim();
    if (/drive\.usercontent\.google\.com/i.test(trimmed)) return trimmed;
    if (/catbox\.moe/i.test(trimmed)) return trimmed;

    const fileIdMatch =
      trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/) ||
      trimmed.match(/drive\.google\.com\/open\?[^#]*\bid=([a-zA-Z0-9_-]+)/) ||
      trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    if (fileIdMatch) {
      return `https://drive.usercontent.google.com/download?id=${fileIdMatch[1]}&export=download&authuser=0`;
    }
    return trimmed;
  }

  private async probeVideoUrl(
    url: string,
  ): Promise<{ ok: boolean; contentType?: string; size?: number }> {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8000) });
      const contentType = res.headers.get('content-type') || '';
      const size = parseInt(res.headers.get('content-length') || '0', 10) || undefined;
      if (!res.ok) return { ok: false, contentType, size };
      if (contentType.includes('text/html') && (!size || size < 500_000)) {
        return { ok: false, contentType, size };
      }
      if (
        contentType.includes('video') ||
        contentType.includes('octet-stream') ||
        (size && size > 500_000)
      ) {
        return { ok: true, contentType, size };
      }
      return { ok: true, contentType, size };
    } catch {
      return { ok: false };
    }
  }

  private async fetchVideoAsBase64(url: string, maxBytes = 50 * 1024 * 1024): Promise<string | null> {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) return null;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html') && buf.length < 500_000) return null;
      return buf.toString('base64');
    } catch {
      return null;
    }
  }

  private sanitizeExplanation(text: string): string {
    let cleaned = text
      .replace(/https?:\/\/[^\s]+/gi, '')
      .replace(/[\t ]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!/siguiente|continuar/i.test(cleaned.slice(-160))) {
      cleaned +=
        '\n\n¿Quieres continuar con la *siguiente pregunta*? Responde *siguiente* o *continuar*.';
    }
    return cleaned;
  }

  private isYoutubeUrl(url: string): boolean {
    return /youtube\.com|youtu\.be/i.test(url);
  }

  private isImageUrl(url: string): boolean {
    return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url);
  }

  private isDocumentUrl(url: string): boolean {
    return /\.pdf(\?|$)/i.test(url);
  }

  /** Agente Resumen + TTS antes de mostrar la pregunta (flujo n8n). */
  private async sendResumenAudio(
    ctx: RuntimeContext,
    question: ModuleQuestion,
    index: number,
    total: number,
    courseId: string,
    moduleId: string,
  ): Promise<void> {
    try {
      const resumenContext = this.buildResumenUserMessage(question, index, total);
      const resumen = await this.llm.runAgent({
        system: RESUMEN_PROMPT,
        userMessage: resumenContext,
        tools: [
          this.ragTool(
            'vector_questions',
            'Busca en el material del módulo los hechos concretos (cifras, nombres, pasos, requisitos) necesarios para responder la pregunta.',
            ctx,
            courseId,
            moduleId,
            this.buildResumenSearchQuery(question),
            8,
          ),
        ],
      });
      if (!resumen?.trim()) return;
      const audio = await this.media.textToSpeechBase64(resumen.slice(0, 4000));
      if (audio) {
        await this.evolution.sendAudio(ctx.tenant.evolution, this.replyTo(ctx), audio);
      }
    } catch (err: any) {
      this.logger.warn(`No se pudo enviar audio-resumen: ${err?.message || err}`);
    }
  }

  /** Contexto estructurado para el agente previo (independiente del dominio del curso). */
  private buildResumenUserMessage(question: ModuleQuestion, index: number, total: number): string {
    const formatted = this.formatQuestion(question, index, total);
    const lines = [
      `Pregunta ${index + 1} de ${total}`,
      `Tipo: ${question.tipo || 'desconocido'}`,
      `Enunciado: ${question.pregunta}`,
    ];

    if (question.opciones?.length) {
      lines.push('Opciones:', ...question.opciones.map((o, i) => `${i + 1}. ${o}`));
    }
    if (question.items?.length) {
      lines.push('Elementos a relacionar:', ...question.items.map((item, i) => `${i + 1}. ${item}`));
    }
    if (question.descripciones?.length) {
      lines.push('Descripciones:', ...question.descripciones);
    }

    lines.push(
      '',
      'Texto que verá el estudiante:',
      formatted,
      '',
      'Tu audio debe cubrir los datos concretos del material que permitan responder esta pregunta.',
      'Si hay espacios en blanco o cifras implícitas, menciónalas explícitamente según el material del módulo.',
    );

    return lines.join('\n');
  }

  /** Consulta RAG orientada a hechos evaluables, válida para cualquier temática. */
  private buildResumenSearchQuery(question: ModuleQuestion): string {
    const parts = [question.pregunta, question.tipo || ''];
    if (question.opciones?.length) parts.push(...question.opciones);
    if (question.items?.length) parts.push(...question.items);
    if (question.descripciones?.length) parts.push(...question.descripciones);
    return parts.filter(Boolean).join('. ');
  }

  private sanitizeFeedback(text: string): string {
    let cleaned = text.trim();
    if (/responde\s+[12]\b|opción\s+[12]\b|opcion\s+[12]\b|\b1\)\s*explicar|\b2\)\s*continuar/i.test(cleaned)) {
      cleaned = cleaned
        .replace(/¿\s*qué\s+quieres\s+hacer[\s\S]*?responde\s+1\s+o\s+2\.?/gi, '')
        .replace(/responde\s+1\s+o\s+2\.?/gi, '')
        .trim();
      if (!/siguiente|continuar|profundiz|explicar/i.test(cleaned.slice(-200))) {
        cleaned +=
          '\n\n¿Quieres que profundice un poco más o seguimos con la *siguiente pregunta*?';
      }
    }
    return cleaned;
  }

  private async buildModuleCompletedMessage(
    completedModuleId: string,
    nextModule: CourseModule | null,
  ): Promise<string> {
    const completed = await this.courseModuleService.findOne(completedModuleId);
    const completedTitle = completed?.title || 'este módulo';

    if (!nextModule) {
      return '¡Felicidades! Has completado todos los módulos disponibles de este curso. 🎉';
    }

    return [
      `¡Felicidades! Has completado el módulo *${completedTitle}*. 🎉`,
      '',
      `El siguiente módulo es *${nextModule.title}*.`,
      '¿Quieres continuar con él? Responde *sí* o *siguiente* para empezar.',
    ].join('\n');
  }

  /**
   * Tras la retroalimentación de una respuesta, el estudiante elige explicar o continuar.
   * Retorna null si el mensaje no es claramente una de esas acciones.
   */
  private classifyPostAnswerAction(message: string): IntentRoute | null {
    const trimmed = message.trim();
    if (/^(1|2)$/.test(trimmed)) {
      return trimmed === '1' ? 'AI_Explicar' : 'AI_Preguntas';
    }
    if (this.wantsPostAnswerExplain(message)) return 'AI_Explicar';
    if (this.wantsPostAnswerContinue(message)) return 'AI_Preguntas';
    return null;
  }

  private wantsPostAnswerExplain(message: string): boolean {
    const t = message.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    if (/^(explicar|explica|explicame|explicación|explicacion)$/.test(t)) return true;
    return /\b(explicar|explicame|explicacion|explicación|mas a fondo|más a fondo|cuentame mas|cuéntame más|profundizar|profundiza|no entendi|no entendí|no comprendi|no comprendí|aclarar|duda|por que|porqué|porque)\b/.test(
      t,
    );
  }

  private wantsPostAnswerContinue(message: string): boolean {
    const t = message.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    if (/^(si|sí|ok|dale|claro|listo|ya|vamos|yes|yep)$/.test(t)) return true;
    return /\b(siguiente|continuar|continua|adelante|seguir|otra pregunta|siguiente pregunta|empecemos|comencemos)\b/.test(
      t,
    );
  }

  private wantsToStartModuleQuestions(message: string): boolean {
    const t = message.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    if (/^(si|sí|ok|dale|claro|listo|ya|vamos|adelante|empecemos|comencemos|yes|yep|bueno|perfecto|de acuerdo|esta bien|está bien)$/.test(t)) {
      return true;
    }
    return /\b(listo|comenzar|comencemos|empezar|empecemos|iniciar|quiero empezar|empezar preguntas|primera pregunta|vamos|arrancar|arranquemos)\b/.test(
      t,
    );
  }

  /** Respaldo para sesiones sin awaitingCourseStartConfirmation persistido. */
  private lastAssistantAskedToStartQuestions(history: ChatTurn[]): boolean {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role !== 'assistant') continue;
      const text = history[i].content.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
      return /\b(empezar|comenzar|iniciar)\b.*\bpreguntas\b|\bpreguntas\b.*\b(curso|modulo|módulo)\b/.test(
        text,
      );
    }
    return false;
  }

  private formatQuestion(question: ModuleQuestion, index: number, total: number): string {
    if (this.isRelacionarQuestion(question)) {
      return this.formatRelacionarQuestion(question, index, total);
    }
    let text = `*Pregunta ${index + 1} de ${total}*\n\n${question.pregunta}`;
    if (question.opciones?.length) {
      text += '\n\n' + question.opciones.map((o, i) => `${i + 1}. ${o}`).join('\n');
    }
    return text;
  }

  private isRelacionarQuestion(question: ModuleQuestion): boolean {
    return question.tipo === 'relacionar' || /relacionar/i.test(question.pregunta);
  }

  private formatRelacionarQuestion(question: ModuleQuestion, index: number, total: number): string {
    const header = `*Pregunta ${index + 1} de ${total}*`;
    const instruction = this.extractRelacionarInstruction(question.pregunta);
    const descripciones =
      question.descripciones?.length
        ? question.descripciones
        : this.extractLetteredLines(question.pregunta);
    const items =
      question.items?.length
        ? question.items
        : (question.opciones || []).filter((op) => !this.isRelacionarAnswerKey(op)).length
          ? (question.opciones || []).filter((op) => !this.isRelacionarAnswerKey(op))
          : this.extractNumberedLines(question.pregunta);

    const parts = [header, '', instruction];
    if (items.length) {
      parts.push(
        '',
        '*Elementos a relacionar:*',
        ...items.map((item, i) => this.formatNumberedListLine(item, i + 1)),
      );
    }
    if (descripciones.length) {
      parts.push('', '*Descripciones:*', ...descripciones.map((d) => this.ensureLetterPrefix(d)));
    }
    parts.push('', 'Responde indicando cada pareja (ej: 1-A, 2-C, 3-B, 4-D).');
    return parts.join('\n');
  }

  private extractRelacionarInstruction(pregunta: string): string {
    const firstBlock = pregunta.split(/\n\s*[A-D][).:-]/)[0].trim();
    return firstBlock || pregunta.trim();
  }

  private extractLetteredLines(text: string): string[] {
    const matches = [...text.matchAll(/(?:^|\n)\s*([A-D][).:-]\s*[^\n]+)/gi)];
    return matches.map((m) => m[1].trim());
  }

  private extractNumberedLines(text: string): string[] {
    return [...text.matchAll(/(?:^|\n)\s*\d+\.\s*([^\n]+)/g)]
      .map((m) => m[1].trim())
      .filter((line) => line && !/^[A-D][).:-]/i.test(line));
  }

  /** Evita duplicar numeración cuando el ítem ya viene como "1. Texto…" o "1. 1. Texto…". */
  private formatNumberedListLine(item: string, index: number): string {
    const stripped = item.trim().replace(/^(\d+\.\s*)+/, '').trim();
    return `${index}. ${stripped}`;
  }

  private isRelacionarAnswerKey(option: string): boolean {
    const t = option.trim();
    return /^[A-D]\s*[):\-]/i.test(t) || /^\d+\s*[-–:]\s*[A-D]\b/i.test(t);
  }

  private ensureLetterPrefix(line: string): string {
    const stripped = line.trim().replace(/^(\d+\.\s*)+/, '').trim();
    return /^[A-Z][).:-]/i.test(stripped) ? stripped : stripped;
  }

  private replyTo(ctx: RuntimeContext): string {
    return ctx.phoneNumber || ctx.recipientJid || '';
  }

  private ragTool(
    name: string,
    description: string,
    ctx: RuntimeContext,
    courseId?: string,
    moduleId?: string,
    fallbackQuery?: string,
    topK = 4,
  ): AgentTool {
    return {
      name,
      description,
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Texto de búsqueda del concepto' } },
        required: ['query'],
      },
      execute: async (args) => {
        if (!courseId) return 'No hay curso activo.';
        const primary = args.query || fallbackQuery || ctx.message;
        let context = await this.rag.retrieveContext(courseId, moduleId, primary, topK);
        if (!context?.trim() && fallbackQuery && primary !== fallbackQuery) {
          context = await this.rag.retrieveContext(courseId, moduleId, fallbackQuery, topK);
        }
        return context || 'No se encontró material relevante en el módulo.';
      },
    };
  }

  private async refreshLastQuestion(
    ctx: RuntimeContext,
    courseId: string,
    moduleId: string,
    formattedQuestion?: string,
  ): Promise<void> {
    let text = formattedQuestion;
    if (!text) {
      const current = await this.questions.getCurrentQuestion(courseId, moduleId, ctx.phoneNumber);
      if (current.state === 'question') {
        text = this.formatQuestion(current.question, current.index, current.total);
      }
    }
    ctx.state = await this.agentState.upsertState(
      ctx.tenant.evolution.instance,
      ctx.phoneNumber,
      ctx.tenant.instructor.id,
      { lastQuestion: text },
    );
  }

  /** Cursos publicados en los que el estudiante (telefono) esta matriculado con este instructor. */
  private async getStudentCourses(ctx: RuntimeContext): Promise<{ id: string; title: string }[]> {
    try {
      const enrollments = await this.studentService.findByPhoneNumber(ctx.phoneNumber);
      const mine = enrollments.filter((s) => s.instructorId === ctx.tenant.instructor.id);
      const courses = await Promise.all(
        mine.map(async (s) => {
          const course = await this.courseService.findOne(s.courseId, ctx.tenant.instructor.id);
          return course && course.status === 'published'
            ? { id: course.id, title: course.title }
            : null;
        }),
      );
      return courses.filter((c): c is { id: string; title: string } => c !== null);
    } catch (err: any) {
      this.logger.error(`Error obteniendo cursos del estudiante: ${err?.message || err}`);
      return [];
    }
  }

  private isCourseListIntent(message: string): boolean {
    const normalized = message
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    return (
      normalized.includes('ver cursos') ||
      normalized.includes('mis cursos') ||
      /\b(ver|mostrar|listar|revisar)\b.*\bcursos?\b/.test(normalized) ||
      /\bcursos?\b.*\b(disponibles|activos|tengo|hay)\b/.test(normalized)
    );
  }

  private formatCourseList(courses: { id: string; title: string }[]): string {
    const lines = courses.map((c) => `- ${c.title}`).join('\n');
    return `Estos son tus cursos disponibles:\n${lines}\n\n¿Cuál te gustaría elegir?`;
  }
}
