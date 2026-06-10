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
    if (ctx.state.offeredNextModuleId && this.wantsToContinueNextModule(ctx.message)) {
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
        ? 'Ya se envió el video intro del módulo. El estudiante debe confirmar (listo/comenzar/empezar) para recibir la primera pregunta.'
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
            { courseId, flujo: 'conversacion', moduleId: undefined },
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
      },
    );

    // Obtener o generar banco de preguntas
    let current = await this.questions.getCurrentQuestion(courseId, moduleId, ctx.phoneNumber);
    if (current.state === 'empty') {
      const generated = await this.questions.generateQuestions(courseId, moduleId);
      if (generated.length === 0) {
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

    // En la pregunta 1 (índice 0): video + confirmación cada vez que retoma ahí.
    // Solo tras confirmar (listo/comenzar) se envía audio-resumen y la pregunta.
    if (current.index === 0) {
      const confirmingStart = this.wantsToStartModuleQuestions(ctx.message);

      if (ctx.state.awaitingModuleStartConfirmation && confirmingStart) {
        ctx.state = await this.agentState.upsertState(
          ctx.tenant.evolution.instance,
          ctx.phoneNumber,
          ctx.tenant.instructor.id,
          { awaitingModuleStartConfirmation: false },
        );
      } else {
        const moduleForIntro = activeModule || (await this.courseModuleService.findOne(moduleId));
        const introSent = await this.sendModuleIntro(ctx, moduleForIntro);

        ctx.state = await this.agentState.upsertState(
          ctx.tenant.evolution.instance,
          ctx.phoneNumber,
          ctx.tenant.instructor.id,
          { awaitingModuleStartConfirmation: true },
        );

        if (introSent) {
          return (
            'Perfecto. Revisa el video con calma. Cuando quieras empezar con las preguntas, ' +
            'escribe *listo*, *comenzar* o *empezar*.'
          );
        }

        if (!confirmingStart) {
          return (
            'Cuando estés listo para la primera pregunta, escribe *listo*, *comenzar* o *empezar*.'
          );
        }

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
    await this.sendResumenAudio(ctx, questionText, courseId, moduleId);

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
    return answer;
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

    return this.llm.runAgent({
      system: EXPLICAR_PROMPT,
      userMessage,
      history: ctx.history,
      tools,
    });
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

      // n8n: cualquier URL en `content` se manda como video (sin exigir .mp4 en la ruta)
      await this.evolution.sendVideo(ctx.tenant.evolution, to, mediaUrl, {
        caption: this.buildModuleVideoCaption(module),
        fileName: `video-${module.id}.mp4`,
      });
      this.logger.log(`Video de modulo enviado moduleId=${module.id}`);
      return true;
    } catch (err: any) {
      this.logger.warn(`No se pudo enviar intro del modulo ${module.id}: ${err?.message || err}`);
      return false;
    }
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
    if (/^https?:\/\//i.test(raw)) return raw;

    const key = raw.replace(/^\//, '');
    try {
      return await this.uploads.getModuleDownloadUrl(module.courseId, module.id, key, 3600);
    } catch {
      const bucket = this.configService.get<string>('S3_BUCKET_MODULES');
      const region = this.configService.get<string>('AWS_REGION') || 'us-east-1';
      return bucket ? `https://${bucket}.s3.${region}.amazonaws.com/${key}` : null;
    }
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
    questionText: string,
    courseId: string,
    moduleId: string,
  ): Promise<void> {
    try {
      const resumen = await this.llm.runAgent({
        system: RESUMEN_PROMPT,
        userMessage: `Organiza una explicacion introductoria breve para esta pregunta:\n${questionText}`,
        tools: [
          this.ragTool(
            'vector_questions',
            'Obtiene material del modulo para la explicacion previa a la pregunta.',
            ctx,
            courseId,
            moduleId,
            questionText,
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
    return /\b(explicar|explicame|explicacion|explicación|mas a fondo|más a fondo|cuentame mas|cuéntame más|profundizar|no entendi|no entendí|no comprendi|no comprendí|aclarar|duda|por que|porqué|porque)\b/.test(
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

  /** Afirmaciones tras ofrecer el siguiente módulo (evita depender solo del LLM clasificador). */
  private wantsToStartModuleQuestions(message: string): boolean {
    const t = message.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    if (/^(si|sí|ok|dale|claro|listo|ya|vamos|adelante|empecemos|comencemos|yes|yep)$/.test(t)) {
      return true;
    }
    return /\b(listo|comenzar|comencemos|empezar|empecemos|iniciar|quiero empezar|empezar preguntas|primera pregunta|vamos)\b/.test(
      t,
    );
  }

  private wantsToContinueNextModule(message: string): boolean {
    return this.wantsToStartModuleQuestions(message);
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

  /** Evita duplicar numeración cuando el ítem ya viene como "1. Texto…". */
  private formatNumberedListLine(item: string, index: number): string {
    const stripped = item.trim().replace(/^\d+\.\s*/, '').trim();
    return `${index}. ${stripped}`;
  }

  private isRelacionarAnswerKey(option: string): boolean {
    const t = option.trim();
    return /^[A-D]\s*[):\-]/i.test(t) || /^\d+\s*[-–:]\s*[A-D]\b/i.test(t);
  }

  private ensureLetterPrefix(line: string): string {
    const t = line.trim();
    return /^[A-D][).:-]/i.test(t) ? t : t;
  }

  private replyTo(ctx: RuntimeContext): string {
    return ctx.recipientJid || ctx.phoneNumber;
  }

  private ragTool(
    name: string,
    description: string,
    ctx: RuntimeContext,
    courseId?: string,
    moduleId?: string,
    fallbackQuery?: string,
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
        let context = await this.rag.retrieveContext(courseId, moduleId, primary, 4);
        if (!context?.trim() && fallbackQuery && primary !== fallbackQuery) {
          context = await this.rag.retrieveContext(courseId, moduleId, fallbackQuery, 4);
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
}
