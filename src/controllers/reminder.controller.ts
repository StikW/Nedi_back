import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReminderService, ReminderRunSummary } from '../services/reminder.service';
import { WhatsAppTemplateType } from '../services/whatsapp.service';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { AdminGuard } from '../strategies/admin.guard';
import { InternalApiKeyGuard } from '../strategies/internal-api-key.guard';

const VALID_TYPES: WhatsAppTemplateType[] = ['welcome', 'daily', 'weekly'];

function assertType(value: unknown): WhatsAppTemplateType {
  if (typeof value !== 'string' || !VALID_TYPES.includes(value as WhatsAppTemplateType)) {
    throw new BadRequestException(
      `type inv\u00e1lido. Valores permitidos: ${VALID_TYPES.join(', ')}`,
    );
  }
  return value as WhatsAppTemplateType;
}

/**
 * Endpoints de recordatorios de WhatsApp. Hay tres familias:
 *
 *   1. P\u00fablico/interno (para crons externos), protegido por `x-internal-api-key`:
 *      - POST /reminders/run/welcome
 *      - POST /reminders/run/daily
 *      - POST /reminders/run/weekly
 *      - POST /reminders/run/all       \u2190 dispara las 3 a la vez
 *      - POST /reminders/run           \u2190 alias hist\u00f3rico (\u2261 daily, o all si TEST_MODE)
 *
 *   2. Admin (JWT + AdminGuard):
 *      - GET  /reminders/preview?type=welcome|daily|weekly  (dry-run)
 *      - POST /reminders/check                              (env\u00edo puntual)
 */
@Controller('reminders')
export class ReminderController {
  constructor(private readonly reminderService: ReminderService) {}

  // ------------------ Internos (cron-friendly) ------------------

  @Post('run')
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async runLegacy(): Promise<ReminderRunSummary> {
    // Mantenido por compatibilidad. En modo TEST manda las 3, en prod manda solo daily.
    return this.reminderService.runByType('daily');
  }

  @Post('run/welcome')
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async runWelcome(): Promise<ReminderRunSummary> {
    return this.reminderService.runByType('welcome');
  }

  @Post('run/daily')
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async runDaily(): Promise<ReminderRunSummary> {
    return this.reminderService.runByType('daily');
  }

  @Post('run/weekly')
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async runWeekly(): Promise<ReminderRunSummary> {
    return this.reminderService.runByType('weekly');
  }

  @Post('run/all')
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  async runAll(): Promise<ReminderRunSummary> {
    return this.reminderService.runAll({ force: true });
  }

  // ------------------ Admin (preview + check) ------------------

  @Get('preview')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async preview(@Query('type') type?: string): Promise<ReminderRunSummary> {
    const t: WhatsAppTemplateType = type ? assertType(type) : 'daily';
    return this.reminderService.previewCandidates(t);
  }

  @Post('check')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @HttpCode(HttpStatus.OK)
  async check(
    @Body()
    body: {
      phoneNumber: string;
      courseId: string;
      type?: string;
      dryRun?: boolean;
      force?: boolean;
    },
  ) {
    const t: WhatsAppTemplateType = body.type ? assertType(body.type) : 'daily';
    return this.reminderService.checkAndNotify(body.phoneNumber, body.courseId, t, {
      dryRun: !!body.dryRun,
      force: !!body.force,
    });
  }
}
