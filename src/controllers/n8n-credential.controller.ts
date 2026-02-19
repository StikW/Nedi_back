import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { N8nCredentialService } from '../services/n8n-credential.service';
import { CreateN8nCredentialDto, UpdateN8nCredentialDto } from '../models/n8n-credential.dto';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { User } from '../models/user.entity';

@Controller('n8n-credentials')
@UseGuards(JwtAuthGuard)
export class N8nCredentialController {
  constructor(private readonly n8nCredentialService: N8nCredentialService) {}

  @Post()
  async create(@Body() createCredentialDto: CreateN8nCredentialDto, @Request() req: any) {
    const user: User = req.user;
    
    // Verificar que el usuario sea instructor
    if (user.role !== 'instructor') {
      throw new HttpException('Solo los instructores pueden crear credenciales', HttpStatus.FORBIDDEN);
    }

    return await this.n8nCredentialService.create(createCredentialDto, user);
  }

  @Get()
  async findAllByInstructor(@Request() req: any) {
    const user: User = req.user;
    
    // Verificar que el usuario sea instructor
    if (user.role !== 'instructor') {
      throw new HttpException('Solo los instructores pueden ver credenciales', HttpStatus.FORBIDDEN);
    }

    return await this.n8nCredentialService.findAllByInstructor(user.id);
  }

  @Get('by-name/:name')
  async findByName(@Param('name') name: string, @Request() req: any) {
    const user: User = req.user;
    
    // Verificar que el usuario sea instructor
    if (user.role !== 'instructor') {
      throw new HttpException('Solo los instructores pueden ver credenciales', HttpStatus.FORBIDDEN);
    }

    const credential = await this.n8nCredentialService.findByName(name, user.id);
    if (!credential) {
      throw new HttpException('Credencial no encontrada', HttpStatus.NOT_FOUND);
    }

    return credential;
  }

  @Get('by-n8n-id/:id_n8n')
  async findByN8nId(@Param('id_n8n') id_n8n: string, @Request() req: any) {
    const user: User = req.user;
    
    // Verificar que el usuario sea instructor
    if (user.role !== 'instructor') {
      throw new HttpException('Solo los instructores pueden ver credenciales', HttpStatus.FORBIDDEN);
    }

    const credential = await this.n8nCredentialService.findByN8nId(id_n8n, user.id);
    if (!credential) {
      throw new HttpException('Credencial no encontrada', HttpStatus.NOT_FOUND);
    }

    return credential;
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    const user: User = req.user;
    
    // Verificar que el usuario sea instructor
    if (user.role !== 'instructor') {
      throw new HttpException('Solo los instructores pueden ver credenciales', HttpStatus.FORBIDDEN);
    }

    const credential = await this.n8nCredentialService.findOne(id, user.id);
    if (!credential) {
      throw new HttpException('Credencial no encontrada', HttpStatus.NOT_FOUND);
    }

    return credential;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateCredentialDto: UpdateN8nCredentialDto, @Request() req: any) {
    const user: User = req.user;
    
    // Verificar que el usuario sea instructor
    if (user.role !== 'instructor') {
      throw new HttpException('Solo los instructores pueden actualizar credenciales', HttpStatus.FORBIDDEN);
    }

    const credential = await this.n8nCredentialService.update(id, updateCredentialDto, user.id);
    if (!credential) {
      throw new HttpException('Credencial no encontrada', HttpStatus.NOT_FOUND);
    }

    return credential;
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Request() req: any) {
    const user: User = req.user;
    
    // Verificar que el usuario sea instructor
    if (user.role !== 'instructor') {
      throw new HttpException('Solo los instructores pueden eliminar credenciales', HttpStatus.FORBIDDEN);
    }

    const deleted = await this.n8nCredentialService.delete(id, user.id);
    if (!deleted) {
      throw new HttpException('Credencial no encontrada', HttpStatus.NOT_FOUND);
    }

    return { message: 'Credencial eliminada exitosamente' };
  }
}
