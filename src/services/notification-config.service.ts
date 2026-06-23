import {
  BadRequestException,
  Injectable,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  CronWeekday,
  DEFAULT_DAILY_SEND_DAYS,
  DEFAULT_SEND_HOUR,
  DEFAULT_WEEKLY_SEND_DAY,
  DEFAULT_WEEKLY_SEND_HOUR,
  NotificationConfig,
  NOTIFICATION_CONFIG_TABLE,
} from '../models/notification-config.entity';
import { UpdateNotificationConfigDto } from '../models/notification-config.dto';
import { WhatsAppTemplateType } from './whatsapp.service';

const CONFIG_ID = 'GLOBAL';

export interface MetaTemplateOption {
  name: string;
  language: string;
  status: string;
  category?: string;
  bodyPreview?: string;
  variableCount: number;
}

export interface EffectiveNotificationConfig {
  whatsappApiVersion: string;
  whatsappPhoneNumberId: string;
  whatsappBusinessAccountId: string;
  whatsappAccessToken: string;
  notificationsEnabled: boolean;
  welcomeTemplateName: string;
  welcomeTemplateLanguage: string;
  welcomeTemplateBodyParams: string;
  dailyTemplateName: string;
  dailyTemplateLanguage: string;
  dailyTemplateBodyParams: string;
  dailySendDays: CronWeekday[];
  dailySendHour: number;
  dailySendMinute: number;
  weeklyTemplateName: string;
  weeklyTemplateLanguage: string;
  weeklyTemplateBodyParams: string;
  weeklySendDay: CronWeekday;
  weeklySendHour: number;
  weeklySendMinute: number;
  reminderCronTimezone: string;
  reminderTestMode: boolean;
  reminderTestPhone?: string;
  reminderTestSchedule: string;
  defaultTemplateName: string;
  defaultTemplateLanguage: string;
  defaultTemplateBodyParams: string;
  updatedAt?: string;
  hasStoredConfig: boolean;
  credentialsConfigured: boolean;
}

@Injectable()
export class NotificationConfigService {
  private cachedStored: NotificationConfig | null | undefined;

  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
  ) {}

  async getEffectiveConfig(): Promise<EffectiveNotificationConfig> {
    const stored = await this.loadStored();
    return this.mergeWithDefaults(stored);
  }

  async getConfigForAdmin(): Promise<
    EffectiveNotificationConfig & { accessTokenConfigured: boolean }
  > {
    const effective = await this.getEffectiveConfig();
    const stored = await this.loadStored();
    const token = effective.whatsappAccessToken;
    const maskedToken = token ? this.maskToken(token) : '';

    return {
      ...effective,
      whatsappAccessToken: stored?.whatsappAccessToken ? maskedToken : effective.whatsappAccessToken,
      accessTokenConfigured: !!token,
    };
  }

  async updateConfig(dto: UpdateNotificationConfigDto): Promise<EffectiveNotificationConfig> {
    const existing = await this.loadStored();
    const mergedStored: NotificationConfig = {
      ...(existing || {}),
      id: CONFIG_ID,
      updatedAt: new Date().toISOString(),
    };

    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      if (key === 'whatsappAccessToken' && this.isMaskedOrEmpty(value as string)) {
        continue;
      }
      if (key === 'dailySendDays' && Array.isArray(value)) {
        (mergedStored as any)[key] = this.normalizeSendDays(value);
        continue;
      }
      (mergedStored as any)[key] = value;
    }

    await this.dynamoClient.send(
      new PutCommand({ TableName: NOTIFICATION_CONFIG_TABLE, Item: mergedStored }),
    );

    this.cachedStored = mergedStored;
    return this.getEffectiveConfig();
  }

  async testConnection(): Promise<{
    connected: boolean;
    phoneNumber?: string;
    businessAccountId?: string;
    error?: string;
    hint?: string;
  }> {
    const cfg = await this.getEffectiveConfig();
    if (!cfg.whatsappPhoneNumberId || !cfg.whatsappAccessToken) {
      return { connected: false, error: 'Faltan Phone Number ID o Access Token' };
    }

    const url = `https://graph.facebook.com/${cfg.whatsappApiVersion}/${cfg.whatsappPhoneNumberId}?fields=display_phone_number,verified_name`;

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${cfg.whatsappAccessToken}` },
      });
      const json: any = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          connected: false,
          error: json?.error?.message || `HTTP ${response.status}`,
        };
      }

      const phoneNumber = json.display_phone_number || json.verified_name;
      const businessAccountId = cfg.whatsappBusinessAccountId?.trim() || undefined;

      return {
        connected: true,
        phoneNumber,
        businessAccountId,
        hint: businessAccountId
          ? undefined
          : 'Conexión OK. Ingresa el Business Account ID (WABA) manualmente para listar plantillas — lo encuentras en Meta Business Suite → WhatsApp → Configuración de la API.',
      };
    } catch (err: any) {
      return { connected: false, error: err?.message || 'Error de conexión' };
    }
  }

  async fetchApprovedTemplates(): Promise<MetaTemplateOption[]> {
    const cfg = await this.getEffectiveConfig();
    if (!cfg.whatsappAccessToken || !cfg.whatsappPhoneNumberId) {
      throw new BadRequestException('Configura Phone Number ID y Access Token primero');
    }

    let businessAccountId = cfg.whatsappBusinessAccountId;
    if (!businessAccountId) {
      const test = await this.testConnection();
      businessAccountId = test.businessAccountId || '';
    }
    if (!businessAccountId) {
      throw new BadRequestException(
        'No se pudo obtener el Business Account ID. Configúralo manualmente o verifica el token.',
      );
    }

    const url = `https://graph.facebook.com/${cfg.whatsappApiVersion}/${businessAccountId}/message_templates?limit=100&fields=name,language,status,category,components`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.whatsappAccessToken}` },
    });
    const json: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new ServiceUnavailableException(
        json?.error?.message || `Error al obtener plantillas de Meta (HTTP ${response.status})`,
      );
    }

    const items: any[] = json?.data || [];
    return items
      .filter((t) => String(t.status || '').toUpperCase() === 'APPROVED')
      .map((t) => ({
        name: t.name as string,
        language: t.language as string,
        status: t.status as string,
        category: t.category as string | undefined,
        bodyPreview: this.extractBodyPreview(t.components),
        variableCount: this.countBodyVariables(t.components),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  buildCronSchedule(
    type: Exclude<WhatsAppTemplateType, 'welcome'>,
    cfg: EffectiveNotificationConfig,
  ): string {
    if (type === 'daily') {
      const days = cfg.dailySendDays.length ? cfg.dailySendDays.join(',') : '1-5';
      return `${cfg.dailySendMinute} ${cfg.dailySendHour} * * ${days}`;
    }
    return `${cfg.weeklySendMinute} ${cfg.weeklySendHour} * * ${cfg.weeklySendDay}`;
  }

  isSendDayToday(type: Exclude<WhatsAppTemplateType, 'welcome'>, cfg: EffectiveNotificationConfig): boolean {
    const today = this.getWeekdayInTimezone(cfg.reminderCronTimezone || 'UTC');
    if (type === 'daily') {
      return cfg.dailySendDays.includes(today);
    }
    return cfg.weeklySendDay === today;
  }

  resolveTemplate(
    type: WhatsAppTemplateType,
    cfg: EffectiveNotificationConfig,
  ): { name: string; language: string; bodyParamsRaw: string } {
    const defaults: Record<WhatsAppTemplateType, string> = {
      welcome: 'name,instructor_phone',
      daily: 'name',
      weekly: 'name',
    };

    const map: Record<WhatsAppTemplateType, { name: string; language: string; bodyParams: string }> = {
      welcome: {
        name: cfg.welcomeTemplateName,
        language: cfg.welcomeTemplateLanguage,
        bodyParams: cfg.welcomeTemplateBodyParams || defaults.welcome,
      },
      daily: {
        name: cfg.dailyTemplateName,
        language: cfg.dailyTemplateLanguage,
        bodyParams: cfg.dailyTemplateBodyParams || defaults.daily,
      },
      weekly: {
        name: cfg.weeklyTemplateName,
        language: cfg.weeklyTemplateLanguage,
        bodyParams: cfg.weeklyTemplateBodyParams || defaults.weekly,
      },
    };

    const specific = map[type];
    return {
      name: specific.name || cfg.defaultTemplateName,
      language: specific.language || cfg.defaultTemplateLanguage || 'es_CO',
      bodyParamsRaw: specific.bodyParams || defaults[type] || cfg.defaultTemplateBodyParams,
    };
  }

  parseBodyParamTokens(raw: string | undefined, type: WhatsAppTemplateType): string[] {
    const defaults: Record<WhatsAppTemplateType, string[]> = {
      welcome: ['name', 'instructor_phone'],
      daily: ['name'],
      weekly: ['name'],
    };

    if (raw === undefined || raw === '') {
      return defaults[type];
    }

    return raw
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
  }

  invalidateCache(): void {
    this.cachedStored = undefined;
  }

  private async loadStored(): Promise<NotificationConfig | null> {
    if (this.cachedStored !== undefined) {
      return this.cachedStored;
    }

    try {
      const result = await this.dynamoClient.send(
        new GetCommand({ TableName: NOTIFICATION_CONFIG_TABLE, Key: { id: CONFIG_ID } }),
      );
      this.cachedStored = (result.Item as NotificationConfig) || null;
    } catch {
      this.cachedStored = null;
    }

    return this.cachedStored;
  }

  private mergeWithDefaults(stored: NotificationConfig | null): EffectiveNotificationConfig {
    const phoneNumberId = stored?.whatsappPhoneNumberId || '';
    const accessToken = stored?.whatsappAccessToken || '';

    return {
      whatsappApiVersion: stored?.whatsappApiVersion || 'v21.0',
      whatsappPhoneNumberId: phoneNumberId,
      whatsappBusinessAccountId: stored?.whatsappBusinessAccountId || '',
      whatsappAccessToken: accessToken,
      notificationsEnabled: stored?.notificationsEnabled ?? false,
      welcomeTemplateName: stored?.welcomeTemplateName || '',
      welcomeTemplateLanguage: stored?.welcomeTemplateLanguage || 'es_CO',
      welcomeTemplateBodyParams: stored?.welcomeTemplateBodyParams || 'name,instructor_phone',
      dailyTemplateName: stored?.dailyTemplateName || '',
      dailyTemplateLanguage: stored?.dailyTemplateLanguage || 'es_CO',
      dailyTemplateBodyParams: stored?.dailyTemplateBodyParams || 'name',
      dailySendDays: stored?.dailySendDays?.length
        ? this.normalizeSendDays(stored.dailySendDays)
        : DEFAULT_DAILY_SEND_DAYS,
      dailySendHour: stored?.dailySendHour ?? DEFAULT_SEND_HOUR,
      dailySendMinute: stored?.dailySendMinute ?? 0,
      weeklyTemplateName: stored?.weeklyTemplateName || '',
      weeklyTemplateLanguage: stored?.weeklyTemplateLanguage || 'es_CO',
      weeklyTemplateBodyParams: stored?.weeklyTemplateBodyParams || 'name',
      weeklySendDay: stored?.weeklySendDay ?? DEFAULT_WEEKLY_SEND_DAY,
      weeklySendHour: stored?.weeklySendHour ?? DEFAULT_WEEKLY_SEND_HOUR,
      weeklySendMinute: stored?.weeklySendMinute ?? 0,
      reminderCronTimezone: stored?.reminderCronTimezone || 'America/Bogota',
      reminderTestMode: stored?.reminderTestMode ?? false,
      reminderTestPhone: stored?.reminderTestPhone?.trim() || undefined,
      reminderTestSchedule: stored?.reminderTestSchedule || '*/30 * * * *',
      defaultTemplateName: stored?.defaultTemplateName || '',
      defaultTemplateLanguage: stored?.defaultTemplateLanguage || 'es_CO',
      defaultTemplateBodyParams: stored?.defaultTemplateBodyParams || '',
      updatedAt: stored?.updatedAt,
      hasStoredConfig: !!stored,
      credentialsConfigured: !!(phoneNumberId && accessToken),
    };
  }

  private normalizeSendDays(days: number[]): CronWeekday[] {
    return Array.from(
      new Set(days.filter((d) => d >= 0 && d <= 6).map((d) => d as CronWeekday)),
    ).sort((a, b) => a - b);
  }

  private extractBodyPreview(components: any[] | undefined): string | undefined {
    const body = components?.find((c) => c.type === 'BODY');
    return body?.text as string | undefined;
  }

  private countBodyVariables(components: any[] | undefined): number {
    const text = this.extractBodyPreview(components) || '';
    const matches = text.match(/\{\{\d+\}\}/g);
    return matches?.length ?? 0;
  }

  private maskToken(token: string): string {
    if (token.length <= 8) return '********';
    return `${token.slice(0, 4)}...${token.slice(-4)}`;
  }

  private isMaskedOrEmpty(value: string): boolean {
    if (!value || !value.trim()) return true;
    return value.includes('...') && !value.startsWith('EAA');
  }

  private getWeekdayInTimezone(timezone: string): CronWeekday {
    try {
      const weekday = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
      }).format(new Date());
      const map: Record<string, CronWeekday> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      if (weekday in map) return map[weekday];
    } catch {
      /* timezone inválida */
    }
    return new Date().getDay() as CronWeekday;
  }
}
