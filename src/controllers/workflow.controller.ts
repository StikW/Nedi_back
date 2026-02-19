import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  UseGuards, 
  Request, 
  Delete, 
  HttpCode, 
  Put,
  HttpStatus,
  HttpException
} from '@nestjs/common';
import { WorkflowService } from '../services/workflow.service';
import { CreateWorkflowDto, UpdateWorkflowDto, N8nExecutionResponse } from '../models/workflow.dto';
import { Workflow } from '../models/workflow.entity';
import { JwtAuthGuard } from '../strategies/jwt-auth.guard';
import { Request as ExpressRequest } from 'express';
import { User } from '../models/user.entity';

interface RequestWithUser extends ExpressRequest {
  user: User;
}

@Controller('workflows')
@UseGuards(JwtAuthGuard)
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Post()
  async create(
    @Body() createWorkflowDto: CreateWorkflowDto,
    @Request() req: RequestWithUser
  ): Promise<Workflow> {
    return this.workflowService.create(createWorkflowDto, req.user);
  }

  @Get()
  async findAllByOwner(
    @Request() req: RequestWithUser
  ): Promise<Workflow[]> {
    return this.workflowService.findAllByOwner(req.user.id);
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Request() req: RequestWithUser
  ): Promise<Workflow | null> {
    const workflow = await this.workflowService.findOne(id, req.user.id);
    if (!workflow) {
      throw new HttpException('Workflow no encontrado', HttpStatus.NOT_FOUND);
    }
    return workflow;
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateWorkflowDto: UpdateWorkflowDto,
    @Request() req: RequestWithUser
  ): Promise<Workflow> {
    const updatedWorkflow = await this.workflowService.update(id, updateWorkflowDto, req.user.id);
    if (!updatedWorkflow) {
      throw new HttpException('Workflow no encontrado o no tienes permisos para actualizarlo', HttpStatus.NOT_FOUND);
    }
    return updatedWorkflow;
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @Param('id') id: string,
    @Request() req: RequestWithUser
  ): Promise<void> {
    const deleted = await this.workflowService.delete(id, req.user.id);
    if (!deleted) {
      throw new HttpException('Workflow no encontrado o no tienes permisos para eliminarlo', HttpStatus.NOT_FOUND);
    }
  }

  @Post(':id/execute')
  async executeWorkflow(
    @Param('id') id: string,
    @Body() body: { inputData?: any },
    @Request() req: RequestWithUser
  ): Promise<N8nExecutionResponse> {
    return this.workflowService.executeWorkflow(id, req.user.id, body.inputData);
  }

  @Put(':id/activate')
  async activateWorkflow(
    @Param('id') id: string,
    @Request() req: RequestWithUser
  ): Promise<Workflow> {
    const activatedWorkflow = await this.workflowService.activateWorkflow(id, req.user.id);
    if (!activatedWorkflow) {
      throw new HttpException('Workflow no encontrado o no tienes permisos para activarlo', HttpStatus.NOT_FOUND);
    }
    return activatedWorkflow;
  }

  @Put(':id/deactivate')
  async deactivateWorkflow(
    @Param('id') id: string,
    @Request() req: RequestWithUser
  ): Promise<Workflow> {
    const deactivatedWorkflow = await this.workflowService.deactivateWorkflow(id, req.user.id);
    if (!deactivatedWorkflow) {
      throw new HttpException('Workflow no encontrado o no tienes permisos para desactivarlo', HttpStatus.NOT_FOUND);
    }
    return deactivatedWorkflow;
  }
}
