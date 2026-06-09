import { Controller, Get, Post, UseGuards, Request } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { User } from '../models/user.entity';
import { EvolutionAdminService } from '../services/agent/evolution-admin.service';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

/**
 * Endpoints para que el instructor conecte su "numero de capacitacion":
 * crea/recupera la instancia de Evolution, configura el webhook y devuelve el
 * QR para vincular WhatsApp; ademas consulta estado y desconecta.
 */
@Controller('agent/evolution')
@UseGuards(JwtAuthGuard)
export class AgentEvolutionController {
  constructor(private readonly evolutionAdmin: EvolutionAdminService) {}

  /** Crea/recupera la instancia y devuelve el QR para vincular el numero. */
  @Post('connect')
  async connect(@Request() req: RequestWithUser) {
    return this.evolutionAdmin.connect(req.user);
  }

  /** Consulta el estado de conexion de la instancia del instructor. */
  @Get('status')
  async status(@Request() req: RequestWithUser) {
    return this.evolutionAdmin.status(req.user);
  }

  /** Desvincula el numero (logout de la instancia). */
  @Post('logout')
  async logout(@Request() req: RequestWithUser) {
    return this.evolutionAdmin.logout(req.user);
  }
}
