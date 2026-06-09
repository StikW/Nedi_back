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
  CONVERSACION_PROMPT,
  PREGUNTAS_PROMPT,
  RESPUESTAS_PROMPT,
  EXPLICAR_PROMPT,
} from './prompts';

export interface RuntimeContext {
  tenant: TenantContext;
  phoneNumber: string;
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
  ) {}

  // ===================================================================
  //  Clasificador de intencion (fusion de los dos classifiers de n8n)
  // ===================================================================

  async classify(ctx: RuntimeContext): Promise<IntentRoute> {
    const context = [
      `Estado de flujo actual: ${ctx.state.flujo}`,
      ctx.state.lastQuestion ? `Última pregunta mostrada: ${ctx.state.lastQuestion}` : 'No hay pregunta activa.',
      `Mensaje del estudiante: ${ctx.message}`,
    ].join('\n');

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

    const system = CONVERSACION_PROMPT.replace('{{coursesTitles}}', titles).replace(
      '{{coursesWithIds}}',
      withIds,
    );

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

    // Resolver modulo activo (primer modulo publicado no completado)
    const previousModuleId = ctx.state.moduleId;
    let moduleId = ctx.state.moduleId;
    let activeModule: CourseModule | null = null;
    if (!moduleId) {
      activeModule = await this.questions.resolveCurrentModule(courseId, ctx.phoneNumber);
      if (!activeModule) {
        return '¡Felicidades! Has completado todos los módulos disponibles de este curso. 🎉';
      }
      moduleId = activeModule.id;
    }

    // Entrar en flujo de preguntas
    ctx.state = await this.agentState.upsertState(
      ctx.tenant.evolution.instance,
      ctx.phoneNumber,
      ctx.tenant.instructor.id,
      { flujo: 'preguntas', moduleId },
    );

    // Al activar un modulo nuevo, enviar su contenido (video/media) una sola vez
    // (equivalente al sub-workflow sendVideo de n8n).
    if (moduleId !== previousModuleId) {
      await this.sendModuleIntro(ctx, activeModule || (await this.courseModuleService.findOne(moduleId)));
    }

    const tools: AgentTool[] = [
      {
        name: 'obtener_pregunta',
        description:
          'Obtiene el estado actual del módulo y la pregunta disponible. Devuelve la pregunta, "questions:null" si no hay banco, o "¡Modulo Finalizado!".',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          const current = await this.questions.getCurrentQuestion(courseId, moduleId!, ctx.phoneNumber);
          if (current.state === 'empty') return JSON.stringify({ questions: null });
          if (current.state === 'finished') return '¡Modulo Finalizado!';
          return JSON.stringify({
            index: current.index + 1,
            total: current.total,
            question: current.question,
          });
        },
      },
      {
        name: 'generador_preguntas',
        description:
          'Genera el banco de preguntas del módulo (SOLO si obtener_pregunta devolvió questions:null).',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          const generated = await this.questions.generateQuestions(courseId, moduleId!);
          return generated.length > 0
            ? `Se generaron ${generated.length} preguntas.`
            : 'No fue posible generar preguntas con el material disponible.';
        },
      },
      {
        name: 'finish_module',
        description:
          'Marca el módulo como completado por el estudiante. Úsalo cuando obtener_pregunta devuelve "¡Modulo Finalizado!".',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          await this.moduleProgressService.completeModule({
            phoneNumber: ctx.phoneNumber,
            moduleId: moduleId!,
            courseId,
          });
          // Avanzar al siguiente modulo y volver a conversacion
          ctx.state = await this.agentState.upsertState(
            ctx.tenant.evolution.instance,
            ctx.phoneNumber,
            ctx.tenant.instructor.id,
            { flujo: 'conversacion', moduleId: undefined, lastQuestion: undefined },
          );
          return 'Módulo marcado como completado.';
        },
      },
    ];

    const answer = await this.llm.runAgent({
      system: PREGUNTAS_PROMPT,
      userMessage: ctx.message,
      history: ctx.history,
      tools,
    });

    // Guardar la pregunta actual como contexto para clasificar la proxima respuesta
    await this.refreshLastQuestion(ctx, courseId, moduleId);
    return answer;
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

    // El estudiante respondio la pregunta actual: avanzar el indice
    if (courseId && moduleId) {
      await this.agentState.advanceQuestion(ctx.phoneNumber, moduleId, courseId);
      await this.refreshLastQuestion(ctx, courseId, moduleId);
    }
    return answer;
  }

  // ===================================================================
  //  Agente de Explicacion
  // ===================================================================

  async runExplicar(ctx: RuntimeContext): Promise<string> {
    const courseId = ctx.state.courseId;
    const moduleId = ctx.state.moduleId;

    const tools: AgentTool[] = [
      this.ragTool(
        'vector_explain',
        'Obtiene material del módulo para explicar el concepto relacionado a la pregunta.',
        ctx,
        courseId,
        moduleId,
      ),
    ];

    const userMessage = ctx.state.lastQuestion
      ? `Pregunta reciente: ${ctx.state.lastQuestion}\nMensaje del estudiante: ${ctx.message}`
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
   * Envia el contenido del modulo (video/imagen/documento o texto) por Evolution.
   * Reemplaza el sub-workflow `sendVideo` de n8n.
   */
  private async sendModuleIntro(ctx: RuntimeContext, module: CourseModule | null): Promise<void> {
    if (!module) return;
    const content = (module.content || '').trim();
    const caption = module.title || '';
    try {
      if (/^https?:\/\//i.test(content)) {
        const lower = content.toLowerCase();
        const isVideo = /\.(mp4|mov|webm|mkv|avi)(\?|$)/.test(lower);
        const isImage = /\.(jpg|jpeg|png|gif|webp)(\?|$)/.test(lower);
        const mediatype = isVideo ? 'video' : isImage ? 'image' : 'document';
        await this.evolution.sendMedia(ctx.tenant.evolution, ctx.phoneNumber, content, {
          mediatype,
          caption,
        });
      } else if (module.description) {
        await this.evolution.sendText(
          ctx.tenant.evolution,
          ctx.phoneNumber,
          `📘 *${caption}*\n${module.description}`,
        );
      }
    } catch (err: any) {
      this.logger.warn(`No se pudo enviar intro del modulo ${module.id}: ${err?.message || err}`);
    }
  }

  private ragTool(
    name: string,
    description: string,
    ctx: RuntimeContext,
    courseId?: string,
    moduleId?: string,
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
        const context = await this.rag.retrieveContext(courseId, moduleId, args.query || ctx.message, 4);
        return context || 'No se encontró material relevante en el módulo.';
      },
    };
  }

  private async refreshLastQuestion(ctx: RuntimeContext, courseId: string, moduleId: string): Promise<void> {
    const current = await this.questions.getCurrentQuestion(courseId, moduleId, ctx.phoneNumber);
    const lastQuestion =
      current.state === 'question'
        ? typeof current.question === 'string'
          ? current.question
          : current.question.pregunta
        : undefined;
    ctx.state = await this.agentState.upsertState(
      ctx.tenant.evolution.instance,
      ctx.phoneNumber,
      ctx.tenant.instructor.id,
      { lastQuestion },
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
