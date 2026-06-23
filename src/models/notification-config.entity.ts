const _tablePrefix = process.env.DYNAMODB_TABLE_PREFIX || '';

/** Días de envío en formato cron (0=domingo … 6=sábado). */
export type CronWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Singleton: credenciales Meta + plantillas de recordatorios WhatsApp. */
export interface NotificationConfig {
  id: 'GLOBAL';
  whatsappApiVersion?: string;
  whatsappPhoneNumberId?: string;
  whatsappBusinessAccountId?: string;
  whatsappAccessToken?: string;
  /** Si false, no se envían bienvenidas ni recordatorios automáticos. */
  notificationsEnabled?: boolean;
  welcomeTemplateName?: string;
  welcomeTemplateLanguage?: string;
  welcomeTemplateBodyParams?: string;
  dailyTemplateName?: string;
  dailyTemplateLanguage?: string;
  dailyTemplateBodyParams?: string;
  /** Días en que se envía el recordatorio diario (0=dom … 6=sáb). Default: lun-vie. */
  dailySendDays?: CronWeekday[];
  dailySendHour?: number;
  dailySendMinute?: number;
  weeklyTemplateName?: string;
  weeklyTemplateLanguage?: string;
  weeklyTemplateBodyParams?: string;
  /** Día de la semana para el recordatorio semanal (0=dom … 6=sáb). Default: viernes. */
  weeklySendDay?: CronWeekday;
  weeklySendHour?: number;
  weeklySendMinute?: number;
  reminderCronTimezone?: string;
  /** Modo prueba (opcional, solo desde admin). */
  reminderTestMode?: boolean;
  reminderTestPhone?: string;
  reminderTestSchedule?: string;
  defaultTemplateName?: string;
  defaultTemplateLanguage?: string;
  defaultTemplateBodyParams?: string;
  updatedAt: string;
}

export const NOTIFICATION_CONFIG_TABLE = _tablePrefix + 'NotificationConfig';

export const DEFAULT_DAILY_SEND_DAYS: CronWeekday[] = [1, 2, 3, 4, 5];
export const DEFAULT_WEEKLY_SEND_DAY: CronWeekday = 5;
export const DEFAULT_SEND_HOUR = 8;
export const DEFAULT_WEEKLY_SEND_HOUR = 17;
