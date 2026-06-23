import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from './users.service';
import { LoginDto, RegisterDto, AuthResponseDto, ChangePasswordDto } from '../models/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  public async register(registerDto: RegisterDto): Promise<AuthResponseDto> {
    const user = await this.usersService.createUser(registerDto);
    const accessToken = this.generateToken(user);

    return {
      token: accessToken,
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  public async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await this.usersService.validatePassword(
      user,
      loginDto.password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.isActive === false) {
      throw new UnauthorizedException('Cuenta desactivada. Contacta al administrador.');
    }

    const accessToken = this.generateToken(user);

    return {
      token: accessToken,
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  /** Logout del cliente: el token deja de usarse localmente (sin blacklist en DynamoDB). */
  public async logout(_token: string): Promise<void> {
    return;
  }

  public async changePassword(userId: string, changePasswordDto: ChangePasswordDto): Promise<{ message: string }> {
    const user = await this.usersService.findById(userId);

    const isCurrentPasswordValid = await this.usersService.validatePassword(user, changePasswordDto.currentPassword);
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('La contraseña actual es incorrecta');
    }

    if (changePasswordDto.currentPassword === changePasswordDto.newPassword) {
      throw new BadRequestException('La nueva contraseña debe ser diferente a la actual');
    }

    await this.usersService.updateUser(userId, {
      password: changePasswordDto.newPassword,
    });

    return { message: 'Contraseña cambiada exitosamente' };
  }

  private generateToken(user: { id: string; email: string; role: string }): string {
    const payload = { sub: user.id, email: user.email, role: user.role };
    return this.jwtService.sign(payload);
  }
}
