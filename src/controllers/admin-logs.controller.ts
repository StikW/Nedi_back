import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { AdminGuard } from '../strategies/admin.guard';
import {
  AgentActivityLevel,
  AgentActivityLogService,
} from '../core/logging/agent-activity-log.service';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/** Logs del agente: buffer en memoria + tail del archivo en disco. */
@Controller('admin/agent/logs')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminLogsController {
  constructor(
    private readonly activityLog: AgentActivityLogService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  listActivity(
    @Query('limit') limit?: string,
    @Query('level') level?: AgentActivityLevel,
    @Query('instance') instance?: string,
  ) {
    return {
      entries: this.activityLog.list({
        limit: limit ? Number(limit) : 100,
        level,
        instance,
      }),
    };
  }

  @Get('file')
  tailFile(@Query('lines') lines?: string) {
    const logDir = this.configService.get<string>('env.logDir') || 'logs';
    const maxLines = Math.min(Math.max(Number(lines) || 200, 10), 1000);
    const filePath = this.resolveLatestLogFile(logDir);

    if (!filePath) {
      return { file: null, lines: [], message: 'Aún no hay archivos de log en disco.' };
    }

    const raw = readFileSync(filePath, 'utf8');
    const allLines = raw.split('\n').filter(Boolean);
    return {
      file: filePath,
      lines: allLines.slice(-maxLines),
    };
  }

  private resolveLatestLogFile(logDir: string): string | null {
    const absoluteDir = join(process.cwd(), logDir);
    if (!existsSync(absoluteDir)) return null;

    const files = readdirSync(absoluteDir)
      .filter((name) => name.startsWith('nedi-') && name.endsWith('.log'))
      .sort()
      .reverse();

    if (files.length === 0) return null;
    return join(absoluteDir, files[0]);
  }
}
