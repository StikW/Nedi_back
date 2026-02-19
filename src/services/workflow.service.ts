import { Inject, Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Workflow, WORKFLOWS_TABLE, WorkflowStatus } from '../models/workflow.entity';
import { CreateWorkflowDto, UpdateWorkflowDto, N8nWorkflowResponse, N8nExecutionResponse } from '../models/workflow.dto';
import { User } from '../models/user.entity';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { TemplateService } from './template.service';

@Injectable()
export class WorkflowService {
  private readonly n8nBaseUrl: string;
  private readonly n8nApiKey: string;

  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
    private readonly configService: ConfigService,
    private readonly templateService: TemplateService,
  ) {
    this.n8nBaseUrl = this.configService.get<string>('N8N_BASE_URL') || 'http://localhost:5678';
    this.n8nApiKey = this.configService.get<string>('N8N_API_KEY') || '';
  }

  async create(createWorkflowDto: CreateWorkflowDto, owner: User): Promise<Workflow> {
    try {
      // Crear workflow en n8n
      const n8nResponse = await this.createWorkflowInN8n(createWorkflowDto);
      
      // Guardar en nuestra base de datos
      const workflow: Workflow = {
        id: uuidv4(),
        name: createWorkflowDto.name,
        description: createWorkflowDto.description,
        definition: createWorkflowDto.definition,
        status: createWorkflowDto.active ? WorkflowStatus.ACTIVE : WorkflowStatus.DRAFT,
        tags: createWorkflowDto.tags || [],
        ownerId: owner.id,
        active: createWorkflowDto.active || false,
        n8nWorkflowId: n8nResponse.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await this.dynamoClient.send(new PutCommand({
        TableName: WORKFLOWS_TABLE,
        Item: workflow
      }));

      return workflow;
    } catch (error) {
      throw new HttpException(
        `Error creando workflow en n8n: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async findAllByOwner(ownerId: string): Promise<Workflow[]> {
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: WORKFLOWS_TABLE,
      IndexName: 'ownerId-index',
      KeyConditionExpression: 'ownerId = :ownerId',
      ExpressionAttributeValues: {
        ':ownerId': ownerId
      }
    }));

    return (result.Items || []) as Workflow[];
  }

  async findOne(id: string, ownerId: string): Promise<Workflow | null> {
    const result = await this.dynamoClient.send(new GetCommand({
      TableName: WORKFLOWS_TABLE,
      Key: { id }
    }));

    const workflow = result.Item as Workflow | undefined;
    return workflow?.ownerId === ownerId ? workflow : null;
  }

  async findByName(name: string, ownerId: string): Promise<Workflow | null> {
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: WORKFLOWS_TABLE,
      IndexName: 'ownerId-index',
      KeyConditionExpression: 'ownerId = :ownerId',
      FilterExpression: '#name = :name',
      ExpressionAttributeNames: {
        '#name': 'name'
      },
      ExpressionAttributeValues: {
        ':ownerId': ownerId,
        ':name': name
      }
    }));

    const workflows = result.Items as Workflow[] || [];
    return workflows.length > 0 ? workflows[0] : null;
  }

  async update(id: string, updateWorkflowDto: UpdateWorkflowDto, ownerId: string): Promise<Workflow | null> {
    const existingWorkflow = await this.findOne(id, ownerId);
    if (!existingWorkflow) {
      return null;
    }

    try {
      // Actualizar workflow en n8n
      const n8nResponse = await this.updateWorkflowInN8n(existingWorkflow.n8nWorkflowId!, updateWorkflowDto);

      // Actualizar en nuestra base de datos
      const updatedWorkflow: Workflow = {
        ...existingWorkflow,
        ...updateWorkflowDto,
        n8nWorkflowId: n8nResponse.id,
        updatedAt: new Date().toISOString()
      };

      await this.dynamoClient.send(new PutCommand({
        TableName: WORKFLOWS_TABLE,
        Item: updatedWorkflow
      }));

      return updatedWorkflow;
    } catch (error) {
      throw new HttpException(
        `Error actualizando workflow en n8n: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async delete(id: string, ownerId: string): Promise<boolean> {
    const workflow = await this.findOne(id, ownerId);
    if (!workflow) {
      return false;
    }

    try {
      // Eliminar workflow de n8n
      await this.deleteWorkflowFromN8n(workflow.n8nWorkflowId!);

      // Eliminar de nuestra base de datos
      await this.dynamoClient.send(new DeleteCommand({
        TableName: WORKFLOWS_TABLE,
        Key: { id }
      }));

      return true;
    } catch (error) {
      throw new HttpException(
        `Error eliminando workflow de n8n: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async activateWorkflow(id: string, ownerId: string): Promise<Workflow | null> {
    const workflow = await this.findOne(id, ownerId);
    if (!workflow) {
      return null;
    }

    try {
      // Activar workflow en n8n
      await this.activateWorkflowInN8n(workflow.n8nWorkflowId!);

      // Actualizar estado en nuestra base de datos
      const updatedWorkflow: Workflow = {
        ...workflow,
        status: WorkflowStatus.ACTIVE,
        active: true,
        updatedAt: new Date().toISOString()
      };

      await this.dynamoClient.send(new PutCommand({
        TableName: WORKFLOWS_TABLE,
        Item: updatedWorkflow
      }));

      return updatedWorkflow;
    } catch (error) {
      throw new HttpException(
        `Error activando workflow en n8n: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async deactivateWorkflow(id: string, ownerId: string): Promise<Workflow | null> {
    const workflow = await this.findOne(id, ownerId);
    if (!workflow) {
      return null;
    }

    try {
      // Desactivar workflow en n8n
      await this.deactivateWorkflowInN8n(workflow.n8nWorkflowId!);

      // Actualizar estado en nuestra base de datos
      const updatedWorkflow: Workflow = {
        ...workflow,
        status: WorkflowStatus.INACTIVE,
        active: false,
        updatedAt: new Date().toISOString()
      };

      await this.dynamoClient.send(new PutCommand({
        TableName: WORKFLOWS_TABLE,
        Item: updatedWorkflow
      }));

      return updatedWorkflow;
    } catch (error) {
      throw new HttpException(
        `Error desactivando workflow en n8n: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async executeWorkflow(id: string, ownerId: string, inputData?: any): Promise<N8nExecutionResponse> {
    const workflow = await this.findOne(id, ownerId);
    if (!workflow) {
      throw new HttpException('Workflow no encontrado', HttpStatus.NOT_FOUND);
    }

    if (!workflow.active) {
      throw new HttpException('El workflow debe estar activo para ejecutarse', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.executeWorkflowInN8n(workflow.n8nWorkflowId!, inputData);
    } catch (error) {
      throw new HttpException(
        `Error ejecutando workflow en n8n: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // Métodos privados para comunicación con n8n

  private async createWorkflowInN8n(workflowData: CreateWorkflowDto): Promise<N8nWorkflowResponse> {
    // Cargar el template del workflow con las credenciales
    const workflowTemplate = this.templateService.loadWorkflowTemplateWithCredentials(
      workflowData.name,
      workflowData.credentials
    );
    
    const response = await fetch(`${this.n8nBaseUrl}/api/v1/workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': this.n8nApiKey,
      },
      body: JSON.stringify(workflowTemplate),
    });

    if (!response.ok) {
      throw new Error(`n8n API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  private async updateWorkflowInN8n(n8nWorkflowId: string, workflowData: UpdateWorkflowDto): Promise<N8nWorkflowResponse> {
    const response = await fetch(`${this.n8nBaseUrl}/api/v1/workflows/${n8nWorkflowId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': this.n8nApiKey,
      },
      body: JSON.stringify({
        name: workflowData.name,
        definition: workflowData.definition,
        active: workflowData.active,
      }),
    });

    if (!response.ok) {
      throw new Error(`n8n API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  private async deleteWorkflowFromN8n(n8nWorkflowId: string): Promise<void> {
    const response = await fetch(`${this.n8nBaseUrl}/api/v1/workflows/${n8nWorkflowId}`, {
      method: 'DELETE',
      headers: {
        'X-N8N-API-KEY': this.n8nApiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`n8n API error: ${response.status} ${response.statusText}`);
    }
  }

  private async activateWorkflowInN8n(n8nWorkflowId: string): Promise<void> {
    const response = await fetch(`${this.n8nBaseUrl}/api/v1/workflows/${n8nWorkflowId}/activate`, {
      method: 'POST',
      headers: {
        'X-N8N-API-KEY': this.n8nApiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`n8n API error: ${response.status} ${response.statusText}`);
    }
  }

  private async deactivateWorkflowInN8n(n8nWorkflowId: string): Promise<void> {
    const response = await fetch(`${this.n8nBaseUrl}/api/v1/workflows/${n8nWorkflowId}/deactivate`, {
      method: 'POST',
      headers: {
        'X-N8N-API-KEY': this.n8nApiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`n8n API error: ${response.status} ${response.statusText}`);
    }
  }

  private async executeWorkflowInN8n(n8nWorkflowId: string, inputData?: any): Promise<N8nExecutionResponse> {
    const response = await fetch(`${this.n8nBaseUrl}/api/v1/workflows/${n8nWorkflowId}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': this.n8nApiKey,
      },
      body: JSON.stringify({
        data: inputData,
      }),
    });

    if (!response.ok) {
      throw new Error(`n8n API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }
}
