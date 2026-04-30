import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ReminderService } from './reminder.service';
import { WhatsAppTemplateType } from './whatsapp.service';

/**
 * Cron interno (in-process) para los recordatorios de WhatsApp.
 *
 * Soporta dos modos, controlados por `REMINDER_CRON_ENABLED` y `REMINDER_TEST_MODE`:
 *
 *   1. TEST MODE (`REMINDER_TEST_MODE=true`)
 *      - Un solo job que dispara las 3 plantillas simult\u00e1neamente.
 *      - Frecuencia: `REMINDER_TEST_SCHEDULE` (default `*\/30 * * * *`).
 *      - Los env\u00edos pueden limitarse a `REMINDER_TEST_PHONE` (recomendado).
 *      - Se ignora la dedup intra-d\u00eda/semana (siempre `force=true`).
 *
 *   2. PROD MODE (`REMINDER_TEST_MODE=false` o ausente)
 *      - 2 jobs separados:
 *          \u2022 daily  \u2192 `REMINDER_DAILY_CRON_SCHEDULE`  (default `0 8 * * *`)
 *          \u2022 weekly \u2192 `REMINDER_WEEKLY_CRON_SCHEDULE` (default `0 17 * * 5`)
 *      - La bienvenida (`welcome`) NO tiene cron: se env\u00eda autom\u00e1ticamente
 *        al crear un estudiante (ver `StudentService.create()` /
 *        `StudentService.importStudentsFromCSV()`). Para reenviar
 *        manualmente: `POST /reminders/run/welcome`.
 *
 * Variables comunes:
 *   - `REMINDER_CRON_ENABLED`  ("true" | "false") activa todo el m\u00f3dulo de cron.
 *   - `REMINDER_CRON_TIMEZONE` TZ IANA (ej. "America/Bogota"). Default: "UTC".
 *
 * Si prefieres disparar todo desde un cron externo (EventBridge / GitHub
 * Actions / cron del SO), deja `REMINDER_CRON_ENABLED=false` y golpea los
 * endpoints `POST /reminders/run/{welcome|daily|weekly|all}` con el header
 * `x-internal-api-key`.
 */
@Injectable()
export class ReminderSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ReminderSchedulerService.name);
  private static readonly TEST_JOB_NAME = 'whatsapp-reminders-test';
  /**
   * Solo daily y weekly tienen cron en producci\u00f3n. La bienvenida es on-create.
   */
  private static readonly PROD_JOBS: Array<Exclude<WhatsAppTemplateType, 'welcome'>> = [
    'daily',
    'weekly',
  ];
  private static readonly JOBS_BY_TYPE: Record<
    Exclude<WhatsAppTemplateType, 'welcome'>,
    string
  > = {
    daily: 'whatsapp-reminders-daily',
    weekly: 'whatsapp-reminders-weekly',
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly reminderService: ReminderService,
  ) {}

  onModuleInit(): void {
    const enabled =
      (this.configService.get<string>('REMINDER_CRON_ENABLED') || '').toLowerCase() === 'true';
    if (!enabled) {
      this.logger.log('REMINDER_CRON_ENABLED!="true" \u2192 cron interno deshabilitado');
      return;
    }

    const timezone = this.configService.get<string>('REMINDER_CRON_TIMEZONE') || 'UTC';
    const testMode =
      (this.configService.get<string>('REMINDER_TEST_MODE') || '').toLowerCase() === 'true';

    if (testMode) {
      this.scheduleTestJob(timezone);
    } else {
      this.scheduleProductionJobs(timezone);
    }
  }

  // =====================================================
  //  TEST MODE
  // =====================================================

  private scheduleTestJob(timezone: string): void {
    const schedule = this.configService.get<string>('REMINDER_TEST_SCHEDULE') || '*/30 * * * *';
    const testPhone = this.configService.get<string>('REMINDER_TEST_PHONE') || '';

    try {
      const job = new CronJob(
        schedule,
        async () => {
          this.logger.log(
            `[TEST] Cron disparado \u2192 enviando welcome+daily+weekly ${
              testPhone ? `solo a ${testPhone}` : 'a TODOS los candidatos'
            }`,
          );
          try {
            const summary = await this.reminderService.runAll({ force: true });
            this.logger.log(
              `[TEST] Cron OK \u2192 enviados=${summary.remindersSent}, fallidos=${summary.remindersFailed}, candidatos=${summary.eligibleCandidates}`,
            );
          } catch (err: any) {
            this.logger.error(`[TEST] Cron de recordatorios fall\u00f3: ${err?.message || err}`);
          }
        },
        null,
        true,
        timezone,
      );

      this.schedulerRegistry.addCronJob(ReminderSchedulerService.TEST_JOB_NAME, job as any);
      this.logger.log(
        `[TEST] Cron de recordatorios programado: schedule="${schedule}" tz=${timezone} testPhone=${testPhone || '(sin filtro)'}`,
      );
    } catch (err: any) {
      this.logger.error(
        `[TEST] No se pudo programar el cron (schedule="${schedule}"): ${err?.message || err}`,
      );
    }
  }

  // =====================================================
  //  PRODUCTION MODE (2 cron jobs separados)
  //
  //  La bienvenida (`welcome`) NO se programa aqu\u00ed: se dispara como
  //  side-effect del alta de estudiantes en `StudentService.create()` y
  //  `StudentService.importStudentsFromCSV()`. Para reenviar manualmente
  //  existe `POST /reminders/run/welcome`.
  // =====================================================

  private scheduleProductionJobs(timezone: string): void {
    const schedules: Record<Exclude<WhatsAppTemplateType, 'welcome'>, string> = {
      daily: this.configService.get<string>('REMINDER_DAILY_CRON_SCHEDULE') || '0 8 * * *',
      weekly: this.configService.get<string>('REMINDER_WEEKLY_CRON_SCHEDULE') || '0 17 * * 5',
    };

    this.logger.log(
      '[PROD] La plantilla `welcome` se env\u00eda al crear cada estudiante (no por cron)',
    );

    ReminderSchedulerService.PROD_JOBS.forEach((type) => {
      const schedule = schedules[type];
      try {
        const job = new CronJob(
          schedule,
          async () => {
            this.logger.log(`[PROD] Cron[${type}] disparado`);
            try {
              const summary = await this.reminderService.runByType(type);
              this.logger.log(
                `[PROD] Cron[${type}] OK \u2192 enviados=${summary.remindersSent}, fallidos=${summary.remindersFailed}, omitidos=${summary.remindersSkippedAlreadySentToday}, candidatos=${summary.eligibleCandidates}`,
              );
            } catch (err: any) {
              this.logger.error(`[PROD] Cron[${type}] fall\u00f3: ${err?.message || err}`);
            }
          },
          null,
          true,
          timezone,
        );

        this.schedulerRegistry.addCronJob(
          ReminderSchedulerService.JOBS_BY_TYPE[type],
          job as any,
        );
        this.logger.log(
          `[PROD] Cron[${type}] programado: schedule="${schedule}" tz=${timezone}`,
        );
      } catch (err: any) {
        this.logger.error(
          `[PROD] No se pudo programar cron[${type}] (schedule="${schedule}"): ${err?.message || err}`,
        );
      }
    });
  }
}
