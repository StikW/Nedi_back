import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StudentService } from './student.service';
import { CourseService } from './course.service';
import { CourseModuleService } from './course-module.service';
import { ModuleProgressService } from './module-progress.service';
import { UsersService } from './users.service';
import { WhatsAppService, WhatsAppTemplateType } from './whatsapp.service';
import { Student } from '../models/student.entity';

export interface ReminderCandidate {
  studentId: string;
  studentName: string;
  phoneNumber: string;
  courseId: string;
  courseTitle: string;
  instructorId: string;
  /**
   * Tel\u00e9fono del instructor configurado en su perfil (DynamoDB).
   * `null` si el instructor todav\u00eda no lo defini\u00f3: en ese caso la
   * plantilla `welcome` (que requiere {{2}}) se omite para este estudiante.
   */
  instructorPhone: string | null;
  totalModules: number;
  completedModules: number;
  daysSinceLastInteraction: number;
  lastInteractionAt: string | null;
  reason: 'no_progress' | 'partial_progress';
}

export interface ReminderRunSummary {
  type: WhatsAppTemplateType | 'all';
  scannedStudents: number;
  eligibleCandidates: number;
  remindersSent: number;
  remindersSkippedAlreadySentToday: number;
  remindersFailed: number;
  testMode: boolean;
  testPhone?: string;
  candidates: ReminderCandidate[];
  failures: Array<{ phoneNumber: string; type: WhatsAppTemplateType; error: string }>;
}

interface RunOptions {
  /** Si es true, no se llama a Meta ni se persiste lastSentAt. */
  dryRun?: boolean;
  /**
   * Si es true, se ignora la dedup intra-d\u00eda/intra-semana.
   * En modo TEST este valor se fuerza a true.
   */
  force?: boolean;
  /**
   * Si est\u00e1 definido, restringe los env\u00edos a este \u00fanico tel\u00e9fono (\u00fatil
   * para pruebas). El candidato se sigue resolviendo desde la BD pero el
   * mensaje se manda al phone de prueba.
   */
  overrideRecipientPhone?: string;
}

/**
 * Servicio de recordatorios por WhatsApp. Soporta 3 tipos de plantillas:
 *   - welcome → nedi_bienvenida_curso  (incluye {{2}} = tel\u00e9fono del instructor)
 *   - daily   → nedi_recordatorio_diario
 *   - weekly  → nedi_reflexion_semanal
 *
 * Reglas (acordadas con producto):
 *   - Se env\u00eda a estudiantes matriculados cuyo curso a\u00fan NO ha sido finalizado
 *     (es decir, completedModules < totalModules de m\u00f3dulos publicados).
 *   - No depende de "d\u00edas sin interacci\u00f3n": mientras el curso no est\u00e9 terminado
 *     el estudiante recibe los recordatorios.
 *   - En producci\u00f3n cada tipo tiene su propia dedup (welcome/daily/weekly).
 *   - En modo TEST se ignora la dedup y se puede limitar a un solo n\u00famero de prueba.
 */
@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => StudentService))
    private readonly studentService: StudentService,
    @Inject(forwardRef(() => CourseService))
    private readonly courseService: CourseService,
    @Inject(forwardRef(() => CourseModuleService))
    private readonly courseModuleService: CourseModuleService,
    @Inject(forwardRef(() => ModuleProgressService))
    private readonly moduleProgressService: ModuleProgressService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    private readonly whatsappService: WhatsAppService,
  ) {}

  // =====================================================
  //  API p\u00fablica de orquestaci\u00f3n
  // =====================================================

  /** Dry-run: lista candidatos sin enviar nada. \u00datil para inspecci\u00f3n manual. */
  async previewCandidates(
    type: WhatsAppTemplateType = 'daily',
  ): Promise<ReminderRunSummary> {
    return this.runByType(type, { dryRun: true, force: true });
  }

  /** Corrida diaria de un tipo espec\u00edfico (lo que el cron de prod llama). */
  async runByType(
    type: WhatsAppTemplateType,
    options: RunOptions = {},
  ): Promise<ReminderRunSummary> {
    const testCfg = this.getTestConfig();
    const effective: RunOptions = {
      ...options,
      force: options.force ?? testCfg.enabled,
      overrideRecipientPhone: options.overrideRecipientPhone || testCfg.testPhone,
    };
    return this.runInternal(type, effective);
  }

  /**
   * Corre los 3 tipos en una sola pasada (lo que usa el cron de PRUEBAS).
   * Cada estudiante elegible recibir\u00e1 las 3 plantillas en r\u00e1pida sucesi\u00f3n.
   */
  async runAll(options: RunOptions = {}): Promise<ReminderRunSummary> {
    const testCfg = this.getTestConfig();
    const effective: RunOptions = {
      ...options,
      force: options.force ?? true,
      overrideRecipientPhone: options.overrideRecipientPhone || testCfg.testPhone,
    };

    const merged: ReminderRunSummary = {
      type: 'all',
      scannedStudents: 0,
      eligibleCandidates: 0,
      remindersSent: 0,
      remindersSkippedAlreadySentToday: 0,
      remindersFailed: 0,
      testMode: testCfg.enabled,
      testPhone: effective.overrideRecipientPhone,
      candidates: [],
      failures: [],
    };

    for (const type of ['welcome', 'daily', 'weekly'] as WhatsAppTemplateType[]) {
      const partial = await this.runInternal(type, effective);
      merged.scannedStudents = Math.max(merged.scannedStudents, partial.scannedStudents);
      merged.eligibleCandidates += partial.eligibleCandidates;
      merged.remindersSent += partial.remindersSent;
      merged.remindersSkippedAlreadySentToday += partial.remindersSkippedAlreadySentToday;
      merged.remindersFailed += partial.remindersFailed;
      merged.failures.push(...partial.failures);
      if (merged.candidates.length === 0) {
        merged.candidates = partial.candidates;
      }
    }

    return merged;
  }

  /**
   * Env\u00eda la plantilla `nedi_bienvenida_curso` a UN solo estudiante reci\u00e9n
   * creado, sin escanear toda la BD ni aplicar dedup.
   *
   * Se usa como side-effect del `StudentService.create()` (alta manual,
   * importaci\u00f3n CSV, auto-inscripci\u00f3n p\u00fablica). Es idempotente desde el
   * punto de vista del flujo: si Meta o el instructor phone fallan, devuelve
   * el motivo pero NO lanza excepci\u00f3n para no romper la creaci\u00f3n del
   * estudiante.
   */
  async sendWelcomeToStudent(student: Student): Promise<{
    sent: boolean;
    skippedReason?: string;
    error?: string;
  }> {
    try {
      const candidate = await this.buildCandidateIfEligible(student);
      if (!candidate) {
        return { sent: false, skippedReason: 'not_eligible' };
      }

      if (!candidate.instructorPhone) {
        this.logger.warn(
          `Bienvenida omitida para estudiante ${student.id}: instructor ${candidate.instructorId} no tiene phoneNumber configurado`,
        );
        return { sent: false, skippedReason: 'instructor_phone_not_configured' };
      }

      const result = await this.whatsappService.sendTemplateMessage(
        student.phoneNumber,
        'welcome',
        { bodyParams: this.buildTemplateParams('welcome', candidate) },
      );

      if (result.success) {
        await this.studentService.markReminderSent(student.id, 'welcome');
        return { sent: true };
      }

      this.logger.warn(
        `Bienvenida fall\u00f3 para ${student.phoneNumber} (estudiante ${student.id}): ${result.error}`,
      );
      return { sent: false, error: result.error || 'Error desconocido' };
    } catch (err: any) {
      this.logger.error(
        `Error inesperado enviando bienvenida al estudiante ${student.id}: ${err?.message || err}`,
      );
      return { sent: false, error: err?.message || 'Error desconocido' };
    }
  }

  /**
   * Verifica un estudiante puntual (por tel\u00e9fono y curso) y, si aplica, le env\u00eda el
   * recordatorio del tipo indicado.
   */
  async checkAndNotify(
    phoneNumber: string,
    courseId: string,
    type: WhatsAppTemplateType = 'daily',
    options: { dryRun?: boolean; force?: boolean } = {},
  ): Promise<{
    eligible: boolean;
    sent: boolean;
    type: WhatsAppTemplateType;
    candidate?: ReminderCandidate;
    skippedReason?: string;
    error?: string;
  }> {
    const { dryRun = false, force = false } = options;

    const student = await this.studentService.findByPhoneAndCourse(phoneNumber, courseId);
    if (!student) {
      return { eligible: false, sent: false, type, skippedReason: 'student_not_found' };
    }

    const candidate = await this.buildCandidateIfEligible(student);
    if (!candidate) {
      return { eligible: false, sent: false, type, skippedReason: 'not_eligible' };
    }

    if (type === 'welcome' && !candidate.instructorPhone) {
      return {
        eligible: true,
        sent: false,
        type,
        candidate,
        skippedReason: 'instructor_phone_not_configured',
      };
    }

    if (!force && this.alreadyDeduped(student, type)) {
      return {
        eligible: true,
        sent: false,
        type,
        candidate,
        skippedReason: 'already_sent_in_window',
      };
    }

    if (dryRun) {
      return { eligible: true, sent: false, type, candidate, skippedReason: 'dry_run' };
    }

    const sendResult = await this.whatsappService.sendTemplateMessage(
      student.phoneNumber,
      type,
      { bodyParams: this.buildTemplateParams(type, candidate) },
    );

    if (sendResult.success) {
      await this.studentService.markReminderSent(student.id, type);
      return { eligible: true, sent: true, type, candidate };
    }

    return {
      eligible: true,
      sent: false,
      type,
      candidate,
      error: sendResult.error || 'Error desconocido enviando WhatsApp',
    };
  }

  // =====================================================
  //  N\u00facleo: corrida por tipo
  // =====================================================

  private async runInternal(
    type: WhatsAppTemplateType,
    options: RunOptions,
  ): Promise<ReminderRunSummary> {
    const testCfg = this.getTestConfig();
    const summary: ReminderRunSummary = {
      type,
      scannedStudents: 0,
      eligibleCandidates: 0,
      remindersSent: 0,
      remindersSkippedAlreadySentToday: 0,
      remindersFailed: 0,
      testMode: testCfg.enabled,
      testPhone: options.overrideRecipientPhone,
      candidates: [],
      failures: [],
    };

    const students = await this.studentService.findAllStudents();
    summary.scannedStudents = students.length;
    this.logger.log(
      `Recordatorios[${type}]: escaneados ${students.length} estudiantes ` +
        `(testMode=${testCfg.enabled}, force=${!!options.force}, override=${options.overrideRecipientPhone || '-'})`,
    );

    for (const student of students) {
      try {
        const candidate = await this.buildCandidateIfEligible(student);
        if (!candidate) continue;

        summary.eligibleCandidates += 1;
        summary.candidates.push(candidate);

        // Bienvenida requiere {{2}} = tel\u00e9fono del instructor. Si no est\u00e1
        // configurado, registramos el caso pero no enviamos a Meta (evita
        // mensajes con texto incompleto).
        if (type === 'welcome' && !candidate.instructorPhone) {
          this.logger.warn(
            `Instructor ${candidate.instructorId} no tiene phoneNumber configurado: ` +
              `omitiendo bienvenida para estudiante ${candidate.studentId}`,
          );
          summary.remindersFailed += 1;
          summary.failures.push({
            phoneNumber: student.phoneNumber,
            type,
            error: 'instructor_phone_not_configured',
          });
          continue;
        }

        if (!options.force && this.alreadyDeduped(student, type)) {
          summary.remindersSkippedAlreadySentToday += 1;
          continue;
        }

        if (options.dryRun) continue;

        const recipient = options.overrideRecipientPhone || student.phoneNumber;
        const result = await this.whatsappService.sendTemplateMessage(recipient, type, {
          bodyParams: this.buildTemplateParams(type, candidate),
        });

        if (result.success) {
          await this.studentService.markReminderSent(student.id, type);
          summary.remindersSent += 1;
        } else {
          summary.remindersFailed += 1;
          summary.failures.push({
            phoneNumber: recipient,
            type,
            error: result.error || 'Error desconocido',
          });
        }
      } catch (err: any) {
        this.logger.error(
          `Fallo evaluando recordatorio[${type}] del estudiante ${student.id}: ${err?.message || err}`,
        );
        summary.remindersFailed += 1;
        summary.failures.push({
          phoneNumber: student.phoneNumber,
          type,
          error: err?.message || 'Error desconocido',
        });
      }
    }

    this.logger.log(
      `Recordatorios[${type}]: candidatos=${summary.eligibleCandidates} enviados=${summary.remindersSent} ` +
        `omitidos=${summary.remindersSkippedAlreadySentToday} fallidos=${summary.remindersFailed} dryRun=${!!options.dryRun}`,
    );

    return summary;
  }

  // =====================================================
  //  Construcci\u00f3n de candidatos
  // =====================================================

  /**
   * Determina si el estudiante est\u00e1 matriculado y a\u00fan no ha terminado el curso.
   *   completedModules < totalModulesPublicados \u2192 elegible
   *   sin m\u00f3dulos publicados                   \u2192 NO elegible (no hay nada por hacer)
   */
  private async buildCandidateIfEligible(
    student: Student,
  ): Promise<ReminderCandidate | null> {
    // Defensivo: en la tabla pueden existir registros "hu\u00e9rfanos" creados por
    // flujos viejos (p. ej. solo {id, loginCount}). Sin courseId/instructorId no
    // hay forma de saber a qu\u00e9 curso est\u00e1 matriculado el estudiante: lo ignoramos.
    if (!student.courseId || !student.instructorId || !student.phoneNumber) {
      this.logger.warn(
        `Estudiante ${student.id} tiene registro incompleto ` +
          `(courseId=${student.courseId ?? 'null'}, instructorId=${student.instructorId ?? 'null'}, ` +
          `phoneNumber=${student.phoneNumber ?? 'null'}): se omite del flujo de recordatorios`,
      );
      return null;
    }

    const course = await this.courseService.findOne(student.courseId, student.instructorId);
    if (!course) return null;

    const publishedModules = await this.courseModuleService.getPublishedModules(student.courseId);
    const totalModules = publishedModules.length;
    if (totalModules === 0) return null;

    const progresses = await this.moduleProgressService.findByPhoneNumberAndCourse(
      student.phoneNumber,
      student.courseId,
    );
    const completedModules = progresses.length;
    if (completedModules >= totalModules) return null; // Curso completado

    const latestProgressMs =
      progresses.length > 0
        ? progresses
            .map((p) => new Date(p.completedAt).getTime())
            .reduce((a, b) => (a > b ? a : b))
        : null;

    const lastInteractionMs = latestProgressMs ?? new Date(student.enrolledAt).getTime();
    const lastInteractionAt = new Date(lastInteractionMs).toISOString();
    const daysSinceLastInteraction = this.daysBetween(lastInteractionMs, Date.now());

    const instructorPhone = await this.resolveInstructorPhone(student.instructorId);

    return {
      studentId: student.id,
      studentName: student.name,
      phoneNumber: student.phoneNumber,
      courseId: student.courseId,
      courseTitle: course.title,
      instructorId: student.instructorId,
      instructorPhone,
      totalModules,
      completedModules,
      daysSinceLastInteraction,
      lastInteractionAt,
      reason: completedModules === 0 ? 'no_progress' : 'partial_progress',
    };
  }

  /**
   * Resuelve el tel\u00e9fono del instructor que se inserta en `nedi_bienvenida_curso`.
   * \u00danica fuente: el campo `phoneNumber` del User (DynamoDB).
   * Si el instructor a\u00fan no lo configur\u00f3 en su perfil, devolvemos `null`
   * y la corrida de `welcome` omitir\u00e1 el env\u00edo para ese estudiante.
   */
  private async resolveInstructorPhone(instructorId: string): Promise<string | null> {
    try {
      const instructor = await this.usersService.findById(instructorId);
      if (instructor?.phoneNumber && instructor.phoneNumber.trim().length > 0) {
        return this.formatPhoneForDisplay(instructor.phoneNumber);
      }
    } catch (err: any) {
      this.logger.warn(
        `No se pudo resolver instructor ${instructorId} para instructor_phone: ${err?.message || err}`,
      );
    }
    return null;
  }

  // =====================================================
  //  Construcci\u00f3n de par\u00e1metros del body
  // =====================================================

  /**
   * Construye los par\u00e1metros que reemplazan los placeholders {{1}}, {{2}}, ... del template.
   *
   * El orden y cantidad se controla con la variable de entorno
   * `WHATSAPP_${TYPE}_TEMPLATE_BODY_PARAMS` (CSV de tokens). Para `daily`, si no
   * est\u00e1 definida, cae al legacy `WHATSAPP_TEMPLATE_BODY_PARAMS` y, en \u00faltima
   * instancia, a `name,course,days`.
   *
   * Tokens soportados:
   *   - name              \u2192 nombre del estudiante
   *   - course            \u2192 t\u00edtulo del curso
   *   - days              \u2192 d\u00edas desde la \u00faltima interacci\u00f3n
   *   - phone             \u2192 tel\u00e9fono del estudiante
   *   - pending           \u2192 m\u00f3dulos pendientes (total - completados)
   *   - total             \u2192 total de m\u00f3dulos publicados
   *   - completed         \u2192 m\u00f3dulos ya completados
   *   - instructor_phone  \u2192 tel\u00e9fono del instructor (para `nedi_bienvenida_curso`)
   */
  private buildTemplateParams(
    type: WhatsAppTemplateType,
    candidate: ReminderCandidate,
  ): string[] {
    const tokens = this.whatsappService.getBodyParamTokens(type);
    const pending = Math.max(0, candidate.totalModules - candidate.completedModules);

    const lookup: Record<string, string> = {
      name: candidate.studentName,
      course: candidate.courseTitle,
      days: String(candidate.daysSinceLastInteraction),
      phone: this.formatPhoneForDisplay(candidate.phoneNumber),
      pending: String(pending),
      total: String(candidate.totalModules),
      completed: String(candidate.completedModules),
      instructor_phone: candidate.instructorPhone ?? '',
    };

    return tokens.map((token) => lookup[token] ?? '');
  }

  // =====================================================
  //  Dedup
  // =====================================================

  /**
   * Indica si ya se mand\u00f3 este tipo de recordatorio recientemente:
   *   - welcome \u2192 hoy
   *   - daily   \u2192 hoy
   *   - weekly  \u2192 en los \u00faltimos 7 d\u00edas
   *
   * En modo TEST esta validaci\u00f3n se omite v\u00eda `options.force = true` desde
   * `runByType` / `runAll`.
   */
  private alreadyDeduped(student: Student, type: WhatsAppTemplateType): boolean {
    const last = this.getLastSentAt(student, type);
    if (!last) return false;

    const lastDate = new Date(last);
    const now = new Date();

    if (type === 'weekly') {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      return now.getTime() - lastDate.getTime() < sevenDaysMs;
    }

    // daily / welcome: deduplicar por d\u00eda calendario (UTC)
    return (
      lastDate.getUTCFullYear() === now.getUTCFullYear() &&
      lastDate.getUTCMonth() === now.getUTCMonth() &&
      lastDate.getUTCDate() === now.getUTCDate()
    );
  }

  private getLastSentAt(student: Student, type: WhatsAppTemplateType): string | undefined {
    switch (type) {
      case 'welcome':
        return student.lastWelcomeSentAt;
      case 'weekly':
        return student.lastWeeklyReflectionSentAt;
      case 'daily':
      default:
        return student.lastDailyReminderSentAt || student.lastReminderSentAt;
    }
  }

  // =====================================================
  //  Helpers
  // =====================================================

  private getTestConfig(): { enabled: boolean; testPhone?: string } {
    const enabled =
      (this.configService.get<string>('REMINDER_TEST_MODE') || '').toLowerCase() === 'true';
    const raw = this.configService.get<string>('REMINDER_TEST_PHONE');
    const testPhone = raw && raw.trim().length > 0 ? raw.trim() : undefined;
    return { enabled, testPhone };
  }

  private daysBetween(fromMs: number, toMs: number): number {
    const diffMs = Math.max(0, toMs - fromMs);
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Formato c\u00f3modo de mostrar a un humano: si viene sin "+" se lo agregamos.
   * Para el env\u00edo a Meta, el `WhatsAppService` lo vuelve a normalizar.
   */
  private formatPhoneForDisplay(phoneNumber: string): string {
    if (!phoneNumber) return '';
    const trimmed = phoneNumber.trim();
    return trimmed.startsWith('+') ? trimmed : `+${trimmed.replace(/\D/g, '')}`;
  }
}
