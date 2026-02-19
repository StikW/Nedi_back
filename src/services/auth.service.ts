import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from './users.service';
import { LoginDto, RegisterDto, AuthResponseDto, ChangePasswordDto } from '../models/auth.dto';
import { TokenBlacklistService } from './token-blacklist.service';

/**
 * Service responsible for authentication operations
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly tokenBlacklistService: TokenBlacklistService,
  ) {}

  /**
   * Registers a new user
   * @param registerDto Registration data
   * @returns Authentication response with token
   */
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

  /**
   * Authenticates a user
   * @param loginDto Login credentials
   * @returns Authentication response with token
   * @throws UnauthorizedException if credentials are invalid
   */
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

    const accessToken = this.generateToken(user);

    return {
      token: accessToken,
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  }

  public async logout(token: string): Promise<void> {
    try {
      // Decodificar el token para obtener la fecha de expiración
      const decoded = this.jwtService.decode(token) as { exp: number };
      if (!decoded || !decoded.exp) {
        throw new UnauthorizedException('Invalid token');
      }

      // Convertir la fecha de expiración a timestamp
      const expiresAt = decoded.exp * 1000;

      // Agregar el token a la lista negra
      await this.tokenBlacklistService.addToBlacklist(token, expiresAt);
    } catch (error) {
      console.error('Error during logout:', error);
      throw new UnauthorizedException('Invalid token');
    }
  }

  /**
   * Changes a user's password
   * @param userId User's ID
   * @param changePasswordDto Password change data
   * @returns Success message
   * @throws UnauthorizedException if current password is invalid
   * @throws BadRequestException if new password is same as current
   */
  public async changePassword(userId: string, changePasswordDto: ChangePasswordDto): Promise<{ message: string }> {
    // Obtener el usuario
    const user = await this.usersService.findById(userId);
    
    // Validar la contraseña actual
    const isCurrentPasswordValid = await this.usersService.validatePassword(user, changePasswordDto.currentPassword);
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('La contraseña actual es incorrecta');
    }

    // Verificar que la nueva contraseña sea diferente a la actual
    if (changePasswordDto.currentPassword === changePasswordDto.newPassword) {
      throw new BadRequestException('La nueva contraseña debe ser diferente a la actual');
    }

    // Actualizar la contraseña
    await this.usersService.updateUser(userId, {
      password: changePasswordDto.newPassword
    });

    return { message: 'Contraseña cambiada exitosamente' };
  }

  /**
   * Generates a JWT token for a user
   * @param user User to generate token for
   * @returns JWT token
   */
  private generateToken(user: { id: string; email: string; role: string }): string {
    const payload = { sub: user.id, email: user.email, role: user.role };
    return this.jwtService.sign(payload);
  }
} 