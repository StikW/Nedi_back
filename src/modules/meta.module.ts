import { Module } from '@nestjs/common';
import { MetaController } from '../controllers/meta.controller';
import { MetaWebhookController } from '../controllers/meta-webhook.controller';
import { MetaContactsService } from '../services/meta-contacts.service';
import { MetaTemplatesService } from '../services/meta-templates.service';
import { MetaApiConfigService } from '../services/meta-api-config.service';
import { MetaWhatsAppCloudService } from '../services/meta-whatsapp-cloud.service';
import { MetaConversationsService } from '../services/meta-conversations.service';
import { MetaWebhookEventsService } from '../services/meta-webhook-events.service';
import { MetaApiLogsService } from '../services/meta-api-logs.service';
import { MetaMessagesService } from '../services/meta-messages.service';
import { MetaGuard } from '../strategies/meta.guard';
import { AuthModule } from './auth.module';

@Module({
  imports: [AuthModule],
  controllers: [MetaController, MetaWebhookController],
  providers: [
    MetaContactsService,
    MetaTemplatesService,
    MetaApiConfigService,
    MetaWhatsAppCloudService,
    MetaConversationsService,
    MetaWebhookEventsService,
    MetaApiLogsService,
    MetaMessagesService,
    MetaGuard,
  ],
  exports: [
    MetaContactsService,
    MetaTemplatesService,
    MetaApiConfigService,
    MetaWhatsAppCloudService,
  ],
})
export class MetaModule {}
