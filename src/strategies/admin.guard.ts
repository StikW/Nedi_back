import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../models/user.entity';

/**
 * Guard that ensures only admin users can access protected endpoints
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    
    if (!token) {
      throw new ForbiddenException('Token de acceso requerido');
    }

    try {
      const payload = this.jwtService.verify(token);
      
      if (payload.role !== UserRole.ADMIN) {
        throw new ForbiddenException('Solo los administradores pueden realizar esta acción');
      }

      // Attach user info to request for use in controllers
      request.user = payload;
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw new ForbiddenException('Token inválido');
    }
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
