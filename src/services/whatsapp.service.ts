import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Tipos de plantilla soportados por el sistema de recordatorios.
 *  - welcome → nedi_bienvenida_curso
 *  - daily   → nedi_recordatorio_diario
 *  - weekly  → nedi_reflexion_semanal
 */
export type WhatsAppTemplateType = 'welcome' | 'daily' | 'weekly';

/**
 * Parámetros que se inyectan en el body del template de WhatsApp.
 * Cada string corresponde a un placeholder {{1}}, {{2}}, ... del template aprobado en Meta.
 */
export interface WhatsAppTemplateParams {
  /** Lista ordenada de valores para los placeholders del cuerpo del template */
  bodyParams: string[];
}

export interface WhatsAppSendResult {
  success: boolean;
  to: string;
  /** ID del mensaje devuelto por Meta cuando es exitoso */
  messageId?: string;
  /** Detalle del error cuando success === false */
  error?: string;
  /** Status HTTP devuelto por Meta */
  statusCode?: number;
}

/** Configuración resuelta para una plantilla específica. */
interface ResolvedTemplateConfig {
  name: string;
  language: string;
}

/**
 * Servicio que envía mensajes por la API oficial de WhatsApp Cloud (Meta Graph API).
 *
 * Variables de entorno requeridas:
 *  - WHATSAPP_PHONE_NUMBER_ID    => ID del número emisor configurado en Meta Business
 *  - WHATSAPP_ACCESS_TOKEN       => Token (preferentemente permanente de System User)
 *  - WHATSAPP_API_VERSION        => (opcional) Versión de la Graph API. Por defecto v21.0
 *
 * Plantillas (una por tipo):
 *  - WHATSAPP_WELCOME_TEMPLATE_NAME / WHATSAPP_WELCOME_TEMPLATE_LANGUAGE
 *  - WHATSAPP_DAILY_TEMPLATE_NAME   / WHATSAPP_DAILY_TEMPLATE_LANGUAGE
 *  - WHATSAPP_WEEKLY_TEMPLATE_NAME  / WHATSAPP_WEEKLY_TEMPLATE_LANGUAGE
 *
 * Legacy: si una de las variables específicas no está definida, se cae a
 * `WHATSAPP_TEMPLATE_NAME` y `WHATSAPP_TEMPLATE_LANGUAGE` para no romper
 * configuraciones previas.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly configService: ConfigService) {}

  /** Lee variable directa de process.env o fallback del namespace `env.*` de Nest. */
  private getEnv(key: string, namespacedKey: string): string | undefined {
    return this.configService.get<string>(key) ?? this.configService.get<string>(namespacedKey);
  }

  /**
   * Envía un template aprobado en Meta a un número específico.
   *
   * @param toPhoneNumber Número destino (en cualquier formato; se normaliza internamente).
   * @param type Tipo de plantilla a usar (welcome | daily | weekly).
   * @param params Parámetros para los placeholders del body.
   */
  async sendTemplateMessage(
    toPhoneNumber: string,
    type: WhatsAppTemplateType,
    params: WhatsAppTemplateParams,
  ): Promise<WhatsAppSendResult> {
    const phoneNumberId = this.getEnv('WHATSAPP_PHONE_NUMBER_ID', 'env.whatsappPhoneNumberId');
    const accessToken = this.getEnv('WHATSAPP_ACCESS_TOKEN', 'env.whatsappAccessToken');
    const apiVersion = this.getEnv('WHATSAPP_API_VERSION', 'env.whatsappApiVersion') || 'v21.0';
    const template = this.resolveTemplateConfig(type);

    if (!phoneNumberId || !accessToken || !template.name) {
      throw new HttpException(
        `WhatsApp no est\u00e1 configurado para el tipo "${type}": faltan credenciales o el nombre del template (revisa WHATSAPP_${type.toUpperCase()}_TEMPLATE_NAME en .env)`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const normalizedTo = this.normalizePhoneForMeta(toPhoneNumber);

    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to: normalizedTo,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        components:
          params.bodyParams.length > 0
            ? [
                {
                  type: 'body',
                  parameters: params.bodyParams.map((value) => ({
                    type: 'text',
                    text: value,
                  })),
                },
              ]
            : [],
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });

      const json: any = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMessage =
          json?.error?.message || json?.error?.error_user_msg || `HTTP ${response.status}`;
        this.logger.error(
          `WhatsApp env\u00edo fall\u00f3 type=${type} template=${template.name} to=${normalizedTo} status=${response.status} msg=${errorMessage}`,
        );
        return {
          success: false,
          to: normalizedTo,
          statusCode: response.status,
          error: errorMessage,
        };
      }

      const messageId = json?.messages?.[0]?.id;
      this.logger.log(
        `WhatsApp enviado type=${type} template=${template.name} to=${normalizedTo} id=${messageId}`,
      );
      return {
        success: true,
        to: normalizedTo,
        statusCode: response.status,
        messageId,
      };
    } catch (err: any) {
      this.logger.error(`Error contactando Meta Graph API: ${err?.message || err}`);
      return {
        success: false,
        to: normalizedTo,
        error: err?.message || 'Error desconocido al contactar la API de WhatsApp',
      };
    }
  }

  /**
   * Devuelve los tokens configurados para construir el body de un tipo de plantilla.
   * Tokens soportados (resueltos por ReminderService):
   *   - name, course, days, phone, pending, total, completed, instructor_phone
   *
   * Variables le\u00edas (en orden):
   *   - WHATSAPP_${TYPE}_TEMPLATE_BODY_PARAMS  (espec\u00edfica del tipo)
   *   - WHATSAPP_TEMPLATE_BODY_PARAMS          (legacy, fallback global)
   *
   * Si no hay nada configurado, retorna [] (template fijo, sin placeholders).
   */
  getBodyParamTokens(type: WhatsAppTemplateType): string[] {
    const upper = type.toUpperCase();
    const bodyParamsNs: Record<WhatsAppTemplateType, string> = {
      welcome: 'env.whatsappWelcomeTemplateBodyParams',
      daily: 'env.whatsappDailyTemplateBodyParams',
      weekly: 'env.whatsappWeeklyTemplateBodyParams',
    };
    const specific = this.getEnv(
      `WHATSAPP_${upper}_TEMPLATE_BODY_PARAMS`,
      bodyParamsNs[type],
    );
    const legacy = this.getEnv('WHATSAPP_TEMPLATE_BODY_PARAMS', 'env.whatsappTemplateBodyParams');
    const raw = specific !== undefined ? specific : legacy;
    if (raw === undefined) {
      return type === 'daily' ? ['name', 'course', 'days'] : [];
    }
    return raw
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
  }

  /**
   * Resuelve nombre+idioma del template para un tipo dado, con fallback al
   * par legacy `WHATSAPP_TEMPLATE_NAME` / `WHATSAPP_TEMPLATE_LANGUAGE`.
   */
  private resolveTemplateConfig(type: WhatsAppTemplateType): ResolvedTemplateConfig {
    const upper = type.toUpperCase();
    const templateNameNs: Record<WhatsAppTemplateType, string> = {
      welcome: 'env.whatsappWelcomeTemplateName',
      daily: 'env.whatsappDailyTemplateName',
      weekly: 'env.whatsappWeeklyTemplateName',
    };
    const templateLanguageNs: Record<WhatsAppTemplateType, string> = {
      welcome: 'env.whatsappWelcomeTemplateLanguage',
      daily: 'env.whatsappDailyTemplateLanguage',
      weekly: 'env.whatsappWeeklyTemplateLanguage',
    };
    const name =
      this.getEnv(`WHATSAPP_${upper}_TEMPLATE_NAME`, templateNameNs[type]) ||
      this.getEnv('WHATSAPP_TEMPLATE_NAME', 'env.whatsappTemplateName') ||
      '';
    const language =
      this.getEnv(`WHATSAPP_${upper}_TEMPLATE_LANGUAGE`, templateLanguageNs[type]) ||
      this.getEnv('WHATSAPP_TEMPLATE_LANGUAGE', 'env.whatsappTemplateLanguage') ||
      'es_CO';
    return { name, language };
  }

  /**
   * Meta requiere el número en formato E.164 sin el "+", solo dígitos (ej. "5215512345678").
   */
  private normalizePhoneForMeta(phoneNumber: string): string {
    return (phoneNumber || '').replace(/\D/g, '');
  }
}
