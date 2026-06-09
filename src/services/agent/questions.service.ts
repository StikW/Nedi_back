import { Injectable, Logger } from '@nestjs/common';
import { CourseModuleService } from '../course-module.service';
import { ModuleProgressService } from '../module-progress.service';
import { AgentStateService } from './agent-state.service';
import { RagService } from './rag.service';
import { LlmService } from './llm.service';
import { CourseModule } from '../../models/course-module.entity';
import { ModuleQuestion } from '../../models/course-module-questions.entity';

const GENERATOR_PROMPT = `Eres un generador de preguntas educativas.
Tu tarea es analizar el contenido proporcionado del módulo de un curso y producir un conjunto de preguntas que evalúen la comprensión del usuario.

Requisitos:
- Genera entre 5 y 7 preguntas por módulo.
- Usa diferentes tipos de preguntas: verdadero/falso, completar la frase, relación de conceptos, opción múltiple, etc.
- Cada pregunta debe incluir opciones de respuesta (si aplica) y la respuesta correcta.
- Las preguntas deben ser objetivas y medibles, nunca de opinión.
- Todas las preguntas deben poder responderse únicamente con la información contenida en el material proporcionado. No inventes ni asumas conocimiento externo.
- Las preguntas no deben ser superficiales, deben tener cierto grado de complejidad.
- Devuelve el resultado ÚNICAMENTE en formato JSON válido con la siguiente estructura:
{
  "preguntas": [
    {
      "pregunta": "Texto de la pregunta",
      "tipo": "opcion_multiple" | "verdadero_falso" | "completar" | "relacionar",
      "opciones": ["opcion1", "opcion2", "opcion3"],
      "respuesta_correcta": "..."
    }
  ]
}`;

export type CurrentQuestionState =
  | { state: 'question'; index: number; total: number; question: ModuleQuestion }
  | { state: 'finished' }
  | { state: 'empty' };

/**
 * Logica del banco de preguntas (reemplaza WF_GeneradorPreguntas y
 * WF_ObtenerPreguntas) y resolucion del modulo activo (reemplaza
 * "Validación de avance modulo").
 */
@Injectable()
export class QuestionsService {
  private readonly logger = new Logger(QuestionsService.name);

  constructor(
    private readonly courseModuleService: CourseModuleService,
    private readonly moduleProgressService: ModuleProgressService,
    private readonly agentState: AgentStateService,
    private readonly rag: RagService,
    private readonly llm: LlmService,
  ) {}

  /**
   * Determina el modulo activo: el primer modulo publicado (por orden) que el
   * estudiante todavia no ha completado.
   */
  async resolveCurrentModule(courseId: string, phoneNumber: string): Promise<CourseModule | null> {
    const published = (await this.courseModuleService.getPublishedModules(courseId)).sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );
    if (published.length === 0) return null;

    const completed = await this.moduleProgressService.findByPhoneNumberAndCourse(phoneNumber, courseId);
    const completedIds = new Set(completed.map((p) => p.moduleId));

    return published.find((m) => !completedIds.has(m.id)) || null;
  }

  /**
   * Devuelve la pregunta actual del modulo segun el avance del estudiante.
   * Equivale a WF_ObtenerPreguntas.
   */
  async getCurrentQuestion(
    courseId: string,
    moduleId: string,
    phoneNumber: string,
  ): Promise<CurrentQuestionState> {
    const bank = await this.agentState.getQuestionBank(courseId, moduleId);
    if (!bank) return { state: 'empty' };

    const index = await this.agentState.getQuestionNumber(phoneNumber, moduleId);
    if (index >= bank.length) return { state: 'finished' };

    return { state: 'question', index, total: bank.length, question: bank[index] };
  }

  /**
   * Genera el banco de preguntas del modulo usando el contenido ya vectorizado
   * (RAG) como material. Equivale a WF_GeneradorPreguntas.
   */
  async generateQuestions(courseId: string, moduleId: string): Promise<ModuleQuestion[]> {
    const module = await this.courseModuleService.findOne(moduleId);
    const baseQuery = module ? `${module.title}. ${module.description}` : 'contenido del modulo';

    // Reutiliza el contenido vectorizado en Pinecone como material fuente
    let material = await this.rag.retrieveContext(courseId, moduleId, baseQuery, 12);
    if (!material || material.trim().length === 0) {
      material = module ? `${module.title}\n${module.description}\n${module.content || ''}` : '';
    }

    const raw = await this.llm.runAgent({
      system: GENERATOR_PROMPT,
      userMessage: `Contenido del módulo:\n${material}`,
    });

    const questions = this.parseQuestions(raw);
    if (questions.length > 0) {
      await this.agentState.saveQuestionBank(courseId, moduleId, questions);
    } else {
      this.logger.warn(`Generador no devolvio preguntas validas para modulo ${moduleId}`);
    }
    return questions;
  }

  private parseQuestions(raw: string): ModuleQuestion[] {
    try {
      // Extraer el bloque JSON aunque venga con texto/markdown alrededor
      const match = raw.match(/\{[\s\S]*\}/);
      const json = JSON.parse(match ? match[0] : raw);
      const arr = json.preguntas || json.questions || json;
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
}
