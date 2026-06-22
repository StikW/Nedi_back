import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Headers,
  HttpCode,
  Logger,
  ForbiddenException,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';
import { MetaApiConfigService } from '../services/meta-api-config.service';
import { MetaWebhookEventsService } from '../services/meta-webhook-events.service';
import { MetaMessagesService } from '../services/meta-messages.service';
import { MetaWhatsAppCloudService } from '../services/meta-whatsapp-cloud.service';

/**
 * Webhook público de WhatsApp Cloud API (Meta).
 * URL para configurar en Meta Developers: https://tututor.co/api/meta/webhook
 */
@Controller('meta/webhook')
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);

  constructor(
    private readonly apiConfigService: MetaApiConfigService,
    private readonly webhookEventsService: MetaWebhookEventsService,
    private readonly messagesService: MetaMessagesService,
    private readonly whatsappCloud: MetaWhatsAppCloudService,
  ) {}

  @Get()
  async verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): Promise<string> {
    const cfg = await this.apiConfigService.getConfig();
    const verifyToken = cfg.verifyToken?.trim();

    if (mode === 'subscribe' && verifyToken && token === verifyToken) {
      this.logger.log('Webhook verificado correctamente por Meta');
      return challenge;
    }

    throw new ForbiddenException('Token de verificación inválido');
  }

  @Post()
  @HttpCode(200)
  async receive(
    @Body() body: Record<string, unknown>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ status: string }> {
    await this.validateSignature(body, signature, req);

    await this.webhookEventsService.create('webhook.received', body);

    const entries = (body.entry as Array<Record<string, unknown>>) || [];
    for (const entry of entries) {
      const changes = (entry.changes as Array<Record<string, unknown>>) || [];
      for (const change of changes) {
        const value = (change.value as Record<string, unknown>) || {};
        const messages = (value.messages as Array<Record<string, unknown>>) || [];
        const contacts = (value.contacts as Array<Record<string, unknown>>) || [];

        for (const message of messages) {
          const from = message.from as string;
          const contact = contacts.find((c) => c.wa_id === from);
          const contactName = (contact?.profile as Record<string, unknown>)?.name as
            | string
            | undefined;
          const textBody =
            ((message.text as Record<string, unknown>)?.body as string) ||
            ((message.button as Record<string, unknown>)?.text as string) ||
            `[${(message.type as string) || 'mensaje'}]`;

          await this.messagesService.create({
            phone: this.whatsappCloud.formatPhoneE164(from),
            contactName,
            direction: 'received',
            body: textBody,
            wamid: message.id as string,
          });

          await this.webhookEventsService.create('message.received', {
            from: this.whatsappCloud.formatPhoneE164(from),
            message: textBody,
            wamid: message.id,
          });
        }

        const statuses = (value.statuses as Array<Record<string, unknown>>) || [];
        for (const status of statuses) {
          await this.webhookEventsService.create('message.status', {
            messageId: status.id,
            status: status.status,
            recipient: status.recipient_id,
          });
        }
      }
    }

    return { status: 'ok' };
  }

  private async validateSignature(
    body: Record<string, unknown>,
    signature: string | undefined,
    req: RawBodyRequest<Request>,
  ): Promise<void> {
    const config = await this.apiConfigService.getConfig();
    const appSecret = config.appSecret?.trim();
    if (!appSecret) return;

    if (!signature) {
      throw new ForbiddenException('Firma del webhook requerida');
    }

    const rawBody = req.rawBody
      ? req.rawBody.toString('utf8')
      : JSON.stringify(body);
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

    if (signature !== expected) {
      throw new ForbiddenException('Firma del webhook inválida');
    }
  }
}
