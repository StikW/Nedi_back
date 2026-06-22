import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { MetaApiConfigService } from './meta-api-config.service';
import { MetaApiLogsService } from './meta-api-logs.service';
import { MetaApiConfig } from '../models/meta-api-config.entity';

export interface MetaGraphResponse {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}

export interface MetaResolvedConfig {
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  appSecret?: string;
  verifyToken?: string;
  graphApiVersion: string;
}

@Injectable()
export class MetaWhatsAppCloudService {
  private readonly logger = new Logger(MetaWhatsAppCloudService.name);

  constructor(
    private readonly apiConfigService: MetaApiConfigService,
    private readonly apiLogsService: MetaApiLogsService,
  ) {}

  async getResolvedConfig(): Promise<MetaResolvedConfig> {
    const config = await this.apiConfigService.getConfig();
    return this.resolveConfig(config);
  }

  resolveConfig(config: MetaApiConfig): MetaResolvedConfig {
    const phoneNumberId = config.phoneNumberId?.trim();
    const businessAccountId = config.businessAccountId?.trim();
    const accessToken = config.accessToken?.trim();

    if (!phoneNumberId || !businessAccountId || !accessToken) {
      throw new BadRequestException(
        'Configura Phone Number ID, Business Account ID y Access Token en Configuración API',
      );
    }

    return {
      phoneNumberId,
      businessAccountId,
      accessToken,
      appSecret: config.appSecret?.trim(),
      verifyToken: config.verifyToken?.trim(),
      graphApiVersion: config.graphApiVersion?.trim() || 'v21.0',
    };
  }

  /** Verifica conectividad con Meta Graph API. */
  async testConnection(): Promise<{ connected: boolean; phoneNumber?: string; error?: string }> {
    try {
      const config = await this.getResolvedConfig();
      const endpoint = `/${config.graphApiVersion}/${config.phoneNumberId}`;
      const result = await this.callGraph('GET', endpoint, undefined, config);
      if (!result.ok) {
        return {
          connected: false,
          error: (result.data?.error as any)?.message || `HTTP ${result.status}`,
        };
      }
      const display = (result.data as any)?.display_phone_number as string | undefined;
      return { connected: true, phoneNumber: display };
    } catch (err: any) {
      return { connected: false, error: err?.message || 'Sin configuración' };
    }
  }

  /** Lista plantillas aprobadas desde Meta Graph API. */
  async fetchTemplatesFromMeta(): Promise<Array<Record<string, unknown>>> {
    const config = await this.getResolvedConfig();
    const endpoint = `/${config.graphApiVersion}/${config.businessAccountId}/message_templates?limit=100`;
    const result = await this.callGraph('GET', endpoint, undefined, config);

    if (!result.ok) {
      const msg = (result.data?.error as any)?.message || `HTTP ${result.status}`;
      throw new ServiceUnavailableException(`Error al obtener plantillas de Meta: ${msg}`);
    }

    return ((result.data as any)?.data as Array<Record<string, unknown>>) || [];
  }

  /** Envía un mensaje template vía WhatsApp Cloud API. */
  async sendTemplateMessage(input: {
    toPhone: string;
    templateName: string;
    language: string;
    bodyParams: string[];
  }): Promise<{ success: boolean; messageId?: string; error?: string; statusCode?: number }> {
    const config = await this.getResolvedConfig();
    const to = this.normalizePhoneForMeta(input.toPhone);
    const endpoint = `/${config.graphApiVersion}/${config.phoneNumberId}/messages`;

    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: input.templateName,
        language: { code: input.language },
        components:
          input.bodyParams.length > 0
            ? [
                {
                  type: 'body',
                  parameters: input.bodyParams.map((text) => ({ type: 'text', text })),
                },
              ]
            : [],
      },
    };

    const result = await this.callGraph('POST', endpoint, body, config);

    if (!result.ok) {
      const errorMessage =
        (result.data?.error as any)?.message ||
        (result.data?.error as any)?.error_user_msg ||
        `HTTP ${result.status}`;
      this.logger.error(`Envío fallido to=${to} template=${input.templateName}: ${errorMessage}`);
      return { success: false, statusCode: result.status, error: errorMessage };
    }

    const messageId = (result.data as any)?.messages?.[0]?.id as string | undefined;
    return { success: true, statusCode: result.status, messageId };
  }

  async callGraph(
    method: string,
    endpoint: string,
    body: Record<string, unknown> | undefined,
    config: MetaResolvedConfig,
  ): Promise<MetaGraphResponse> {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `https://graph.facebook.com${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
    };

    if (body && method !== 'GET') {
      init.body = JSON.stringify(body);
    }

    let status = 0;
    let data: Record<string, unknown> = {};

    try {
      const response = await fetch(url, init);
      status = response.status;
      data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    } catch (err: any) {
      status = 0;
      data = { error: { message: err?.message || 'Error de red' } };
    }

    await this.apiLogsService.create({
      method,
      endpoint: endpoint.replace(config.accessToken, '***'),
      status: status || 500,
      request: body || {},
      response: data,
    });

    return { ok: status >= 200 && status < 300, status: status || 500, data };
  }

  normalizePhoneForMeta(phone: string): string {
    return (phone || '').replace(/\D/g, '');
  }

  formatPhoneE164(phone: string): string {
    const digits = this.normalizePhoneForMeta(phone);
    return digits ? `+${digits}` : phone;
  }
}
