import { Controller, Get, Put, Delete, Param, Body, UseGuards, Query, Request } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { UsersService } from '../services/users.service';
import { UpdateUserDto, UserResponseDto, DeleteUserResultDto } from '../models/user.dto';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { AdminGuard } from '../strategies/admin.guard';
import { PaginationDto, PaginatedResponseDto } from '../models/pagination.dto';
import { User } from '../models/user.entity';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

/**
 * Controller responsible for user management endpoints (Admin only)
 */
@Controller('users')
@UseGuards(JwtAuthGuard, AdminGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Lists all users (Admin only)
   * @param paginationDto Pagination parameters
   * @returns List of users without passwords
   */
  @Get()
  public async listUsers(
    @Query() paginationDto: PaginationDto,
  ): Promise<UserResponseDto[] | PaginatedResponseDto<UserResponseDto>> {
    // Si se proporcionan parámetros de paginación, usar paginación
    if (paginationDto.cursor || paginationDto.sortOrder) {
      return this.usersService.listUsersPaginated(paginationDto);
    }
    
    // Si no hay parámetros de paginación, retornar todos los usuarios (comportamiento original)
    const result = await this.usersService.listUsers();
    return result.users;
  }

  /**
   * Search users by email (Admin only)
   * @param paginationDto Pagination parameters
   * @param email Email to search for
   * @returns List of users matching the email search
   */
  @Get('search/:email')
  public async searchUsersByEmail(
    @Param('email') email: string,
    @Query() paginationDto: PaginationDto,
  ): Promise<UserResponseDto[] | PaginatedResponseDto<UserResponseDto>> {
    // Si se proporcionan parámetros de paginación, usar paginación
    if (paginationDto.cursor || paginationDto.sortOrder) {
      return this.usersService.searchUsersByEmailPaginated(email, paginationDto);
    }
    
    // Si no hay parámetros de paginación, retornar todos los usuarios que coincidan
    return this.usersService.searchUsersByEmail(email);
  }

  /**
   * Gets a specific user by ID (Admin only)
   * @param id User's ID
   * @returns User information without password
   */
  @Get(':id')
  public async getUserById(@Param('id') id: string): Promise<UserResponseDto> {
    const user = await this.usersService.findById(id);
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword as UserResponseDto;
  }

  /**
   * Updates a user's information (Admin only)
   * @param id User's ID
   * @param updateDto Data to update
   * @returns Updated user without password
   */
  @Put(':id')
  public async updateUser(
    @Param('id') id: string,
    @Body() updateDto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.usersService.updateUser(id, updateDto);
  }

  /**
   * Elimina un usuario (Admin only).
   * Si es instructor: borra cursos, Pinecone/S3 asociados, estados del agente e instancia Evolution.
   */
  @Delete(':id')
  public async deleteUser(
    @Param('id') id: string,
    @Request() req: RequestWithUser,
  ): Promise<DeleteUserResultDto> {
    return this.usersService.deleteUser(id, req.user.id);
  }
}
