import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { AdminGuard } from '../strategies/admin.guard';
import { NotificationConfigService } from '../services/notification-config.service';
import { UpdateNotificationConfigDto } from '../models/notification-config.dto';
import { ReminderSchedulerService } from '../services/reminder-scheduler.service';

/** Configuración de Meta/WhatsApp y plantillas de recordatorios (rol admin). */
@Controller('admin/notification-config')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminNotificationConfigController {
  constructor(
    private readonly configService: NotificationConfigService,
    private readonly schedulerService: ReminderSchedulerService,
  ) {}

  @Get()
  getConfig() {
    return this.configService.getConfigForAdmin();
  }

  @Get('templates')
  fetchTemplates() {
    return this.configService.fetchApprovedTemplates();
  }

  @Put()
  async updateConfig(@Body() dto: UpdateNotificationConfigDto) {
    await this.configService.updateConfig(dto);
    await this.schedulerService.rescheduleFromConfig();
    return this.configService.getConfigForAdmin();
  }

  @Post('test')
  async testConnection() {
    const result = await this.configService.testConnection();
    if (result.connected) {
      await this.schedulerService.rescheduleFromConfig();
    }
    return result;
  }
}
