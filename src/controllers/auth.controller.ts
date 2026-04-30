import { Body, Controller, Get, Post, Put, Request, UseGuards } from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { UsersService } from '../services/users.service';
import { LoginDto, RegisterDto, AuthResponseDto, ChangePasswordDto } from '../models/auth.dto';
import { UpdateUserDto, UserResponseDto } from '../models/user.dto';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { AdminGuard } from '../strategies/admin.guard';
import { Request as ExpressRequest } from 'express';
import { User } from '../models/user.entity';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

/**
 * Controller responsible for authentication endpoints
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Registers a new user (Admin only)
   * @param registerDto Registration data
   * @returns Authentication response with token
   */
  @Post('register')
  @UseGuards(JwtAuthGuard, AdminGuard)
  public async register(
    @Body() registerDto: RegisterDto,
  ): Promise<AuthResponseDto> {
    return this.authService.register(registerDto);
  }

  /**
   * Authenticates a user
   * @param loginDto Login credentials
   * @returns Authentication response with token
   */
  @Post('login')
  public async login(@Body() loginDto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(loginDto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  public async logout(@Request() req: ExpressRequest): Promise<{ message: string }> {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      throw new Error('No token provided');
    }
    
    await this.authService.logout(token);
    return { message: 'Logged out successfully' };
  }

  /**
   * Changes user password
   * @param changePasswordDto Password change data
   * @param req Request with authenticated user
   * @returns Success message
   */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  public async changePassword(
    @Body() changePasswordDto: ChangePasswordDto,
    @Request() req: RequestWithUser
  ): Promise<{ message: string }> {
    return this.authService.changePassword(req.user.id, changePasswordDto);
  }

  /**
   * Obtiene el perfil del usuario autenticado.
   * \u00datil para refrescar datos como `phoneNumber` que pueden no estar en el token JWT.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  public async getMyProfile(@Request() req: RequestWithUser): Promise<UserResponseDto> {
    return this.usersService.getMyProfile(req.user.id);
  }

  /**
   * Permite al usuario autenticado actualizar su propio perfil.
   * Solo deja modificar los campos seguros: name, email y phoneNumber.
   */
  @Put('me')
  @UseGuards(JwtAuthGuard)
  public async updateMyProfile(
    @Body() updateDto: UpdateUserDto,
    @Request() req: RequestWithUser,
  ): Promise<UserResponseDto> {
    return this.usersService.updateMyProfile(req.user.id, updateDto);
  }
}
