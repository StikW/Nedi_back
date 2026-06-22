import { Injectable, Logger } from '@nestjs/common';
import { CourseModuleService } from '../course-module.service';
import { ModuleProgressService } from '../module-progress.service';
import { AgentStateService } from './agent-state.service';
import { RagService } from './rag.service';
import { LlmService } from './llm.service';
import { VectorizationService } from './vectorization.service';
import { CourseModule } from '../../models/course-module.entity';
import { ModuleQuestion } from '../../models/course-module-questions.entity';

const GENERATOR_PROMPT = `Eres un generador de preguntas educativas.
Tu tarea es analizar el contenido proporcionado del módulo de un curso y producir un conjunto de preguntas que evalúen la comprensión del usuario sobre los CONCEPTOS y APRENDIZAJES del material.

Requisitos:
- Genera entre 5 y 7 preguntas por módulo.
- Usa diferentes tipos de preguntas: verdadero/falso, completar la frase, relación de conceptos, opción múltiple, etc.
- Cada pregunta debe incluir opciones de respuesta (si aplica) y la respuesta correcta.
- Para tipo "relacionar":
  - "items": lista de conceptos SIN numeración inicial (solo el texto del concepto).
  - "descripciones": lista de definiciones con letras A), B), C)... en orden alfabético.
  - "respuesta_correcta": pares item-letra (ej. "1-C, 2-A, 3-B, 4-D") donde el emparejamiento NO sea secuencial (evita 1-A, 2-B, 3-C...).
  - NO incluyas la respuesta correcta ni pares ya resueltos en "opciones".
  - "pregunta" solo debe tener la instrucción breve.
- Para tipo "completar" u "opcion_multiple": la respuesta debe estar respaldada por un dato explícito del material (cifra, nombre, plazo, definición, etc.); evita preguntas cuyo dato clave no aparezca en el contenido del módulo.
- Las preguntas deben ser objetivas y medibles, nunca de opinión.
- Todas las preguntas deben poder responderse únicamente con la información contenida en el material proporcionado. No inventes ni asumas conocimiento externo.
- Las preguntas no deben ser superficiales, deben tener cierto grado de complejidad.
- PROHIBIDO generar preguntas sobre metadatos del documento: títulos exactos, encabezados repetidos, URLs, parámetros de enlaces, estructura del archivo o cantidad de veces que aparece un texto. Evalúa solo el contenido educativo (ideas, definiciones, procesos, habilidades, ejemplos).
- Devuelve el resultado ÚNICAMENTE en formato JSON válido con la siguiente estructura:
{
  "preguntas": [
    {
      "pregunta": "Texto de la pregunta",
      "tipo": "opcion_multiple" | "verdadero_falso" | "completar" | "relacionar",
      "opciones": ["opcion1", "opcion2"],
      "items": ["solo si tipo es relacionar"],
      "descripciones": ["A) ...", "B) ..."],
      "respuesta_correcta": "..."
    }
  ]
}`;

export type GenerateQuestionsResult = {
  questions: ModuleQuestion[];
  /** true cuando no hay PDF/TXT del modulo en S3 ni en recursos registrados */
  noDocument?: boolean;
};

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
    private readonly vectorization: VectorizationService,
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
   * Genera el banco de preguntas del modulo usando el documento completo del
   * modulo (PDF/TXT en S3), igual que WF_GeneradorPreguntas en n8n.
   */
  async generateQuestions(courseId: string, moduleId: string): Promise<GenerateQuestionsResult> {
    const doc = await this.vectorization.extractModuleDocumentText(courseId, moduleId);
    let material = doc.text;

    if (!material && doc.source === 'none') {
      material = await this.rag.retrieveAllModuleContext(courseId, moduleId);
    }

    if (!material || material.trim().length < 80) {
      this.logger.warn(
        `Material insuficiente para generar preguntas del modulo ${moduleId} (source=${doc.source}, files=${doc.files})`,
      );
      return { questions: [], noDocument: doc.files === 0 && doc.source !== 's3' };
    }

    if (doc.source === 'fallback') {
      this.logger.warn(
        `Generando preguntas del modulo ${moduleId} solo con titulo/descripcion; sube un PDF y re-vectoriza.`,
      );
    }

    const raw = await this.llm.runAgent({
      system: GENERATOR_PROMPT,
      userMessage: `Contenido del módulo:\n${material}`,
    });

    const questions = this.postProcessQuestions(this.parseQuestions(raw));
    if (questions.length > 0) {
      await this.agentState.saveQuestionBank(courseId, moduleId, questions);
      return { questions };
    }

    this.logger.warn(`Generador no devolvio preguntas validas para modulo ${moduleId}`);
    return { questions: [] };
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

  /** Normaliza preguntas de relacionar: limpia numeración y baraja descripciones. */
  private postProcessQuestions(questions: ModuleQuestion[]): ModuleQuestion[] {
    return questions.map((q) => this.normalizeRelacionarQuestion(q));
  }

  private normalizeRelacionarQuestion(question: ModuleQuestion): ModuleQuestion {
    const isRelacionar =
      question.tipo === 'relacionar' || /relacionar/i.test(question.pregunta || '');
    if (!isRelacionar) return question;

    const rawItems = question.items?.length ? question.items : [];
    const rawDescriptions = question.descripciones?.length ? question.descripciones : [];
    if (rawItems.length < 2 || rawDescriptions.length < 2) return question;

    const items = rawItems.map((item) => stripLeadingNumbering(item));
    const descriptionTexts = rawDescriptions.map((line) => stripLetterPrefix(line));

    const shuffledIndices = shuffleIndices(descriptionTexts.length);
    const shuffledDescriptions = shuffledIndices.map(
      (origIdx, newIdx) => `${indexToLetter(newIdx)}) ${descriptionTexts[origIdx]}`,
    );

    const answerPairs = parseRelacionarAnswer(String(question.respuesta_correcta || ''));
    const remappedAnswer =
      answerPairs.length > 0
        ? answerPairs
            .map(({ item, letter }) => {
              const origIdx = letterToIndex(letter);
              const newIdx = shuffledIndices.indexOf(origIdx);
              return newIdx >= 0 ? `${item}-${indexToLetter(newIdx)}` : null;
            })
            .filter(Boolean)
            .join(', ')
        : question.respuesta_correcta;

    return {
      ...question,
      tipo: 'relacionar',
      items,
      descripciones: shuffledDescriptions,
      respuesta_correcta: remappedAnswer,
    };
  }
}

function stripLeadingNumbering(text: string): string {
  return text.trim().replace(/^(\d+\.\s*)+/, '').trim();
}

function stripLetterPrefix(text: string): string {
  return text.trim().replace(/^[A-Z][).:\-]\s*/i, '').trim();
}

function letterToIndex(letter: string): number {
  return letter.toUpperCase().charCodeAt(0) - 65;
}

function indexToLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function shuffleIndices(length: number): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  if (length > 2 && isSequentialShuffle(indices)) {
    return shuffleIndices(length);
  }
  return indices;
}

/** Evita que la columna B quede en el mismo orden A,B,C... tras barajar. */
function isSequentialShuffle(indices: number[]): boolean {
  return indices.every((origIdx, newIdx) => origIdx === newIdx);
}

function parseRelacionarAnswer(raw: string): { item: string; letter: string }[] {
  const pairs: { item: string; letter: string }[] = [];
  for (const match of raw.matchAll(/(\d+)\s*[-–:→>]\s*([A-Z])/gi)) {
    pairs.push({ item: match[1], letter: match[2].toUpperCase() });
  }
  return pairs;
}
