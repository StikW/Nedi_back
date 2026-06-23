import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ReminderService } from './reminder.service';
import { NotificationConfigService } from './notification-config.service';
import { WhatsAppTemplateType } from './whatsapp.service';

/** Cron interno de recordatorios WhatsApp (config desde panel admin). */
@Injectable()
export class ReminderSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ReminderSchedulerService.name);
  private static readonly TEST_JOB_NAME = 'whatsapp-reminders-test';
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
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly reminderService: ReminderService,
    private readonly notificationConfigService: NotificationConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.rescheduleFromConfig();
  }

  async rescheduleFromConfig(): Promise<void> {
    this.removeAllReminderJobs();

    const cfg = await this.notificationConfigService.getEffectiveConfig();
    if (!cfg.notificationsEnabled) return;

    const timezone = cfg.reminderCronTimezone || 'America/Bogota';

    if (cfg.reminderTestMode) {
      this.scheduleTestJob(cfg.reminderTestSchedule, timezone);
      return;
    }

    this.scheduleProductionJobs(cfg, timezone);
  }

  private removeAllReminderJobs(): void {
    const names = [
      ReminderSchedulerService.TEST_JOB_NAME,
      ...Object.values(ReminderSchedulerService.JOBS_BY_TYPE),
    ];
    for (const name of names) {
      try {
        if (this.schedulerRegistry.doesExist('cron', name)) {
          this.schedulerRegistry.deleteCronJob(name);
        }
      } catch {
        /* job no existía */
      }
    }
  }

  private scheduleTestJob(schedule: string, timezone: string): void {
    try {
      const job = new CronJob(
        schedule,
        async () => {
          try {
            await this.reminderService.runAll({ force: true });
          } catch (err: any) {
            this.logger.error(`Cron TEST falló: ${err?.message || err}`);
          }
        },
        null,
        true,
        timezone,
      );

      this.schedulerRegistry.addCronJob(ReminderSchedulerService.TEST_JOB_NAME, job as any);
    } catch (err: any) {
      this.logger.error(`No se pudo programar cron TEST: ${err?.message || err}`);
    }
  }

  private scheduleProductionJobs(
    cfg: Awaited<ReturnType<NotificationConfigService['getEffectiveConfig']>>,
    timezone: string,
  ): void {
    ReminderSchedulerService.PROD_JOBS.forEach((type) => {
      const schedule = this.notificationConfigService.buildCronSchedule(type, cfg);
      try {
        const job = new CronJob(
          schedule,
          async () => {
            try {
              await this.reminderService.runByType(type);
            } catch (err: any) {
              this.logger.error(`Cron[${type}] falló: ${err?.message || err}`);
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
      } catch (err: any) {
        this.logger.error(`No se pudo programar cron[${type}]: ${err?.message || err}`);
      }
    });
  }
}
