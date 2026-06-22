import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { MetaGuard } from '../strategies/meta.guard';
import { MetaContactsService } from '../services/meta-contacts.service';
import { MetaTemplatesService } from '../services/meta-templates.service';
import { MetaApiConfigService } from '../services/meta-api-config.service';
import { MetaWhatsAppCloudService } from '../services/meta-whatsapp-cloud.service';
import { MetaConversationsService } from '../services/meta-conversations.service';
import { MetaWebhookEventsService } from '../services/meta-webhook-events.service';
import { MetaApiLogsService } from '../services/meta-api-logs.service';
import { MetaMessagesService } from '../services/meta-messages.service';
import {
  CreateMetaContactDto,
  UpdateMetaContactDto,
  CreateMetaTemplateDto,
  UpdateMetaTemplateDto,
  UpdateMetaApiConfigDto,
  SendMetaMessageDto,
} from '../models/meta.dto';

/** Panel Meta — integración real con WhatsApp Business Cloud API. */
@Controller('meta')
@UseGuards(JwtAuthGuard, MetaGuard)
export class MetaController {
  constructor(
    private readonly contactsService: MetaContactsService,
    private readonly templatesService: MetaTemplatesService,
    private readonly apiConfigService: MetaApiConfigService,
    private readonly whatsappCloud: MetaWhatsAppCloudService,
    private readonly conversationsService: MetaConversationsService,
    private readonly webhookEventsService: MetaWebhookEventsService,
    private readonly apiLogsService: MetaApiLogsService,
    private readonly messagesService: MetaMessagesService,
  ) {}

  @Get('dashboard/stats')
  async getDashboardStats() {
    const connection = await this.whatsappCloud.testConnection();
    const webhookRecent = await this.webhookEventsService.hasRecentEvent(24);

    const localTemplates = await this.templatesService.findAll();
    let availableTemplates = localTemplates.filter((t) => t.status === 'approved').length;

    if (availableTemplates === 0) {
      try {
        const metaTemplates = await this.whatsappCloud.fetchTemplatesFromMeta();
        availableTemplates = metaTemplates.filter(
          (t) => (t.status as string)?.toUpperCase() === 'APPROVED',
        ).length;
      } catch {
        availableTemplates = localTemplates.length;
      }
    }

    return {
      messagesSentToday: await this.messagesService.countSentToday(),
      messagesReceived: await this.messagesService.countReceivedToday(),
      activeConversations: await this.messagesService.countActiveConversations(),
      availableTemplates,
      webhookStatus: webhookRecent ? 'active' : 'pending',
      metaConnectionStatus: connection.connected ? 'connected' : 'disconnected',
      connectionError: connection.error,
      phoneNumber: connection.phoneNumber,
    };
  }

  @Get('contacts')
  listContacts() {
    return this.contactsService.findAll();
  }

  @Get('contacts/:id')
  getContact(@Param('id') id: string) {
    return this.contactsService.findById(id);
  }

  @Post('contacts')
  createContact(@Body() dto: CreateMetaContactDto) {
    return this.contactsService.create(dto);
  }

  @Put('contacts/:id')
  updateContact(@Param('id') id: string, @Body() dto: UpdateMetaContactDto) {
    return this.contactsService.update(id, dto);
  }

  @Delete('contacts/:id')
  async deleteContact(@Param('id') id: string) {
    await this.contactsService.delete(id);
    return { message: 'Contacto eliminado' };
  }

  /** Plantillas locales (sincronizar desde Meta con POST /templates/sync). */
  @Get('templates')
  listTemplates() {
    return this.templatesService.findAll();
  }

  @Post('templates/sync')
  async syncTemplatesFromMeta() {
    const metaTemplates = await this.whatsappCloud.fetchTemplatesFromMeta();
    const synced = [];

    for (const t of metaTemplates) {
      const name = t.name as string;
      const language = (t.language as string) || 'es';
      const status = ((t.status as string) || 'PENDING').toLowerCase() as
        | 'approved'
        | 'pending'
        | 'rejected';
      const content = this.extractTemplateBody(t);

      const existing = (await this.templatesService.findAll()).find(
        (local) => local.name === name && local.language === language,
      );

      if (existing) {
        synced.push(
          await this.templatesService.update(existing.id, {
            category: (t.category as string) || existing.category,
            status,
            content,
          }),
        );
      } else {
        synced.push(
          await this.templatesService.create({
            name,
            category: (t.category as string) || 'UTILITY',
            language,
            status,
            content,
          }),
        );
      }
    }

    return { synced: synced.length, templates: synced };
  }

  @Get('templates/:id')
  getTemplate(@Param('id') id: string) {
    return this.templatesService.findById(id);
  }

  @Post('templates')
  createTemplate(@Body() dto: CreateMetaTemplateDto) {
    return this.templatesService.create(dto);
  }

  @Put('templates/:id')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateMetaTemplateDto) {
    return this.templatesService.update(id, dto);
  }

  @Delete('templates/:id')
  async deleteTemplate(@Param('id') id: string) {
    await this.templatesService.delete(id);
    return { message: 'Plantilla eliminada' };
  }

  @Post('messages/send')
  async sendMessage(@Body() dto: SendMetaMessageDto) {
    const contact = await this.contactsService.findById(dto.contactId);
    const template = await this.templatesService.findById(dto.templateId);

    if (template.status !== 'approved') {
      throw new ServiceUnavailableException(
        'La plantilla debe estar aprobada en Meta. Usa "Sincronizar desde Meta".',
      );
    }

    const bodyParams = this.resolveBodyParams(template.content, dto.variables || {});

    const result = await this.whatsappCloud.sendTemplateMessage({
      toPhone: contact.phone,
      templateName: template.name,
      language: template.language,
      bodyParams,
    });

    if (!result.success) {
      throw new ServiceUnavailableException(result.error || 'Error al enviar mensaje');
    }

    await this.messagesService.create({
      phone: this.whatsappCloud.formatPhoneE164(contact.phone),
      contactName: contact.name,
      direction: 'sent',
      body: this.renderTemplatePreview(template.content, dto.variables || {}),
      wamid: result.messageId,
      templateName: template.name,
    });

    return {
      success: true,
      messageId: result.messageId,
      contact: { id: contact.id, name: contact.name, phone: contact.phone },
      template: { id: template.id, name: template.name },
      variables: dto.variables || {},
      sentAt: new Date().toISOString(),
    };
  }

  @Get('conversations')
  getConversations() {
    return this.conversationsService.listConversations();
  }

  @Get('conversations/:id/messages')
  getConversationMessages(@Param('id') id: string) {
    return this.conversationsService.getMessages(id);
  }

  @Get('webhooks/events')
  getWebhookEvents() {
    return this.webhookEventsService.findAll();
  }

  @Get('api-config')
  getApiConfig() {
    return this.apiConfigService.getConfig();
  }

  @Put('api-config')
  updateApiConfig(@Body() dto: UpdateMetaApiConfigDto) {
    return this.apiConfigService.updateConfig(dto);
  }

  @Post('api-config/test')
  testConnection() {
    return this.whatsappCloud.testConnection();
  }

  @Get('logs')
  getLogs() {
    return this.apiLogsService.findAll();
  }

  private extractTemplateBody(t: Record<string, unknown>): string {
    const components = (t.components as Array<Record<string, unknown>>) || [];
    const body = components.find((c) => c.type === 'BODY');
    return (body?.text as string) || '';
  }

  private resolveBodyParams(content: string, variables: Record<string, string>): string[] {
    const matches = content.match(/\{\{(\d+)\}\}/g) || [];
    const indices = [...new Set(matches.map((m) => m.replace(/\D/g, '')))].sort(
      (a, b) => Number(a) - Number(b),
    );
    return indices.map((i) => variables[i] || '');
  }

  private renderTemplatePreview(content: string, variables: Record<string, string>): string {
    let result = content;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
  }
}
