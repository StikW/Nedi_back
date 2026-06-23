import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { NotificationConfigService } from './notification-config.service';

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

/**
 * Servicio que envía mensajes por la API oficial de WhatsApp Cloud (Meta Graph API).
 * Lee credenciales y plantillas desde DynamoDB (panel admin) con fallback a `.env`.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly notificationConfigService: NotificationConfigService) {}

  /**
   * Envía un template aprobado en Meta a un número específico.
   */
  async sendTemplateMessage(
    toPhoneNumber: string,
    type: WhatsAppTemplateType,
    params: WhatsAppTemplateParams,
  ): Promise<WhatsAppSendResult> {
    const cfg = await this.notificationConfigService.getEffectiveConfig();
    const template = this.notificationConfigService.resolveTemplate(type, cfg);

    if (!cfg.whatsappPhoneNumberId || !cfg.whatsappAccessToken || !template.name) {
      throw new HttpException(
        `WhatsApp no está configurado para el tipo "${type}": faltan credenciales o el nombre del template`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const normalizedTo = this.normalizePhoneForMeta(toPhoneNumber);
    const url = `https://graph.facebook.com/${cfg.whatsappApiVersion}/${cfg.whatsappPhoneNumberId}/messages`;
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
          Authorization: `Bearer ${cfg.whatsappAccessToken}`,
        },
        body: JSON.stringify(body),
      });

      const json: any = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorMessage =
          json?.error?.message || json?.error?.error_user_msg || `HTTP ${response.status}`;
        this.logger.error(
          `WhatsApp envío falló type=${type} template=${template.name} to=${normalizedTo} status=${response.status} msg=${errorMessage}`,
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
   * Tokens configurados para construir el body de un tipo de plantilla.
   * Tokens soportados: name, course, days, phone, pending, total, completed, instructor_phone
   */
  async getBodyParamTokens(type: WhatsAppTemplateType): Promise<string[]> {
    const cfg = await this.notificationConfigService.getEffectiveConfig();
    const template = this.notificationConfigService.resolveTemplate(type, cfg);
    return this.notificationConfigService.parseBodyParamTokens(template.bodyParamsRaw, type);
  }

  private normalizePhoneForMeta(phoneNumber: string): string {
    return (phoneNumber || '').replace(/\D/g, '');
  }
}
