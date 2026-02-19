import { Inject, Injectable, HttpException, HttpStatus, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { N8nCredential, N8N_CREDENTIALS_TABLE } from '../models/n8n-credential.entity';
import { CreateN8nCredentialDto, UpdateN8nCredentialDto, N8nCredentialResponse } from '../models/n8n-credential.dto';
import { User } from '../models/user.entity';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { WorkflowService } from './workflow.service';

@Injectable()
export class N8nCredentialService {
  private readonly n8nBaseUrl: string;
  private readonly n8nApiKey: string;

  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => WorkflowService))
    private readonly workflowService: WorkflowService,
  ) {
    this.n8nBaseUrl = this.configService.get<string>('N8N_BASE_URL') || 'http://localhost:5678';
    this.n8nApiKey = this.configService.get<string>('N8N_API_KEY') || '';
  }

  async create(createCredentialDto: CreateN8nCredentialDto, instructor: User): Promise<N8nCredential> {
    try {
      // Crear credencial en n8n
      const n8nResponse = await this.createCredentialInN8n(createCredentialDto);
      
      // Guardar en nuestra base de datos
      const credential: N8nCredential = {
        id: uuidv4(),
        name: createCredentialDto.name,
        type: createCredentialDto.type,
        id_n8n: createCredentialDto.id_n8n || n8nResponse.id,
        instructorId: instructor.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // Incluir los campos específicos según el tipo
        clientId: createCredentialDto.clientId,
        clientSecret: createCredentialDto.clientSecret,
        accessToken: createCredentialDto.accessToken,
        businessAccountId: createCredentialDto.businessAccountId,
        apiKey: createCredentialDto.apiKey,
        value: createCredentialDto.value,
      };

      await this.dynamoClient.send(new PutCommand({
        TableName: N8N_CREDENTIALS_TABLE,
        Item: credential
      }));

      return credential;
    } catch (error) {
      throw new HttpException(
        `Error creando credencial en n8n: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async findAllByInstructor(instructorId: string): Promise<N8nCredential[]> {
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: N8N_CREDENTIALS_TABLE,
      IndexName: 'instructorId-index',
      KeyConditionExpression: 'instructorId = :instructorId',
      ExpressionAttributeValues: {
        ':instructorId': instructorId
      }
    }));

    return (result.Items || []) as N8nCredential[];
  }

  async findOne(id: string, instructorId: string): Promise<N8nCredential | null> {
    const result = await this.dynamoClient.send(new GetCommand({
      TableName: N8N_CREDENTIALS_TABLE,
      Key: { id }
    }));

    const credential = result.Item as N8nCredential | undefined;
    return credential?.instructorId === instructorId ? credential : null;
  }

  async findByN8nId(id_n8n: string, instructorId: string): Promise<N8nCredential | null> {
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: N8N_CREDENTIALS_TABLE,
      IndexName: 'instructorId-index',
      KeyConditionExpression: 'instructorId = :instructorId',
      FilterExpression: 'id_n8n = :id_n8n',
      ExpressionAttributeValues: {
        ':instructorId': instructorId,
        ':id_n8n': id_n8n
      }
    }));

    const credentials = result.Items as N8nCredential[] || [];
    return credentials.length > 0 ? credentials[0] : null;
  }

  async findByName(name: string, instructorId: string): Promise<N8nCredential | null> {
    const result = await this.dynamoClient.send(new QueryCommand({
      TableName: N8N_CREDENTIALS_TABLE,
      IndexName: 'instructorId-index',
      KeyConditionExpression: 'instructorId = :instructorId',
      FilterExpression: '#name = :name',
      ExpressionAttributeNames: {
        '#name': 'name'
      },
      ExpressionAttributeValues: {
        ':instructorId': instructorId,
        ':name': name
      }
    }));

    const credentials = result.Items as N8nCredential[] || [];
    return credentials.length > 0 ? credentials[0] : null;
  }

  async update(id: string, updateCredentialDto: UpdateN8nCredentialDto, instructorId: string): Promise<N8nCredential | null> {
    const existingCredential = await this.findOne(id, instructorId);
    if (!existingCredential) {
      return null;
    }

    try {
      // Eliminar credencial existente de n8n
      await this.deleteCredentialFromN8n(existingCredential.id_n8n);

      // Crear nueva credencial en n8n con los datos actualizados
      const createDto: CreateN8nCredentialDto = {
        name: updateCredentialDto.name || existingCredential.name,
        type: updateCredentialDto.type || existingCredential.type,
        id_n8n: '', // Se generará automáticamente
        // Campos específicos según el tipo
        ...(updateCredentialDto.type === 'whatsAppTriggerApi' || existingCredential.type === 'whatsAppTriggerApi' ? {
          clientId: updateCredentialDto.clientId || '',
          clientSecret: updateCredentialDto.clientSecret || ''
        } : {}),
        ...(updateCredentialDto.type === 'whatsAppApi' || existingCredential.type === 'whatsAppApi' ? {
          accessToken: updateCredentialDto.accessToken || '',
          businessAccountId: updateCredentialDto.businessAccountId || ''
        } : {}),
        ...(updateCredentialDto.type === 'httpHeaderAuth' || existingCredential.type === 'httpHeaderAuth' ? {
          value: updateCredentialDto.value || ''
        } : {}),
        ...(updateCredentialDto.type === 'openAiApi' || existingCredential.type === 'openAiApi' ? {
          apiKey: updateCredentialDto.apiKey || ''
        } : {})
      };

      const n8nResponse = await this.createCredentialInN8n(createDto);

      // Actualizar en nuestra base de datos con el nuevo id_n8n
      const updatedCredential: N8nCredential = {
        ...existingCredential,
        ...updateCredentialDto,
        id_n8n: n8nResponse.id,
        updatedAt: new Date().toISOString()
      };

      await this.dynamoClient.send(new PutCommand({
        TableName: N8N_CREDENTIALS_TABLE,
        Item: updatedCredential
      }));

      // Actualizar workflows asociados con las nuevas credenciales
      await this.updateAssociatedWorkflows(instructorId, updatedCredential);

      return updatedCredential;
    } catch (error) {
      throw new HttpException(
        `Error actualizando credencial en n8n: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async delete(id: string, instructorId: string): Promise<boolean> {
    const credential = await this.findOne(id, instructorId);
    if (!credential) {
      return false;
    }

    try {
      // Eliminar credencial de n8n
      await this.deleteCredentialFromN8n(credential.id_n8n);

      // Eliminar de nuestra base de datos
      await this.dynamoClient.send(new DeleteCommand({
        TableName: N8N_CREDENTIALS_TABLE,
        Key: { id }
      }));

      return true;
    } catch (error) {
      throw new HttpException(
        `Error eliminando credencial de n8n: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  // Métodos privados para comunicación con n8n

  private async createCredentialInN8n(credentialData: CreateN8nCredentialDto): Promise<N8nCredentialResponse> {
    // Construir la estructura de datos según el tipo de credencial
    let data = {};
    
    if (credentialData.type === 'whatsAppTriggerApi') {
      data = {
        clientId: credentialData.clientId || '',
        clientSecret: credentialData.clientSecret || ''
      };
    } else if (credentialData.type === 'whatsAppApi') {
      data = {
        accessToken: credentialData.accessToken || '',
        businessAccountId: credentialData.businessAccountId || ''
      };
    } else if (credentialData.type === 'httpHeaderAuth') {
      data = {
        name: 'Authorization',
        value: credentialData.value || ''
      };
    } else if (credentialData.type === 'openAiApi') {
      data = {
        apiKey: credentialData.apiKey || '',
        url: 'https://api.openai.com/v1'
      };
    }

    const response = await fetch(`${this.n8nBaseUrl}/api/v1/credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': this.n8nApiKey,
      },
      body: JSON.stringify({
        name: credentialData.name,
        type: credentialData.type,
        data: data
      }),
    });

    if (!response.ok) {
      throw new Error(`n8n API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }


  private async deleteCredentialFromN8n(n8nCredentialId: string): Promise<void> {
    const response = await fetch(`${this.n8nBaseUrl}/api/v1/credentials/${n8nCredentialId}`, {
      method: 'DELETE',
      headers: {
        'X-N8N-API-KEY': this.n8nApiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`n8n API error: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Actualiza los workflows asociados con las nuevas credenciales
   */
  private async updateAssociatedWorkflows(instructorId: string, updatedCredential: N8nCredential): Promise<void> {
    try {
      // Obtener todos los workflows del instructor
      const workflows = await this.workflowService.findAllByOwner(instructorId);
      
      // Obtener todas las credenciales del instructor para construir el objeto de credenciales
      const allCredentials = await this.findAllByInstructor(instructorId);
      
      // Construir el objeto de credenciales para el template
      const credentialsObject = this.buildCredentialsObject(allCredentials);
      
      // Actualizar cada workflow con las nuevas credenciales
      for (const workflow of workflows) {
        if (workflow.n8nWorkflowId) {
          await this.updateWorkflowWithCredentials(workflow.n8nWorkflowId, workflow.name, credentialsObject);
        }
      }
      
      console.log(`Workflows actualizados para instructor ${instructorId} con credencial ${updatedCredential.name}`);
    } catch (error) {
      console.error(`Error actualizando workflows para instructor ${instructorId}:`, error);
      // No lanzamos el error para no interrumpir la actualización de credenciales
    }
  }

  /**
   * Construye el objeto de credenciales para el template
   */
  private buildCredentialsObject(credentials: N8nCredential[]): {
    whatsAppTriggerApiId: string;
    whatsAppTriggerApiName: string;
    openAiApiId: string;
    openAiApiName: string;
    httpBearerAuthId: string;
    httpBearerAuthName: string;
    whatsAppApiId: string;
    whatsAppApiName: string;
  } {
    const credentialsObject = {
      whatsAppTriggerApiId: '',
      whatsAppTriggerApiName: '',
      openAiApiId: '',
      openAiApiName: '',
      httpBearerAuthId: '',
      httpBearerAuthName: '',
      whatsAppApiId: '',
      whatsAppApiName: ''
    };

    credentials.forEach(cred => {
      switch (cred.type) {
        case 'whatsAppTriggerApi':
          credentialsObject.whatsAppTriggerApiId = cred.id_n8n;
          credentialsObject.whatsAppTriggerApiName = cred.name;
          break;
        case 'openAiApi':
          credentialsObject.openAiApiId = cred.id_n8n;
          credentialsObject.openAiApiName = cred.name;
          break;
        case 'httpHeaderAuth':
          credentialsObject.httpBearerAuthId = cred.id_n8n;
          credentialsObject.httpBearerAuthName = cred.name;
          break;
        case 'whatsAppApi':
          credentialsObject.whatsAppApiId = cred.id_n8n;
          credentialsObject.whatsAppApiName = cred.name;
          break;
      }
    });

    return credentialsObject;
  }

  /**
   * Actualiza un workflow específico en n8n con las nuevas credenciales
   */
  private async updateWorkflowWithCredentials(
    n8nWorkflowId: string, 
    workflowName: string, 
    credentials: any
  ): Promise<void> {
    try {
      // Obtener el workflow actual de n8n
      const currentWorkflowResponse = await fetch(`${this.n8nBaseUrl}/api/v1/workflows/${n8nWorkflowId}`, {
        method: 'GET',
        headers: {
          'X-N8N-API-KEY': this.n8nApiKey,
        },
      });

      if (!currentWorkflowResponse.ok) {
        throw new Error(`Error obteniendo workflow: ${currentWorkflowResponse.status}`);
      }

      const currentWorkflow = await currentWorkflowResponse.json();
      
      // Actualizar las credenciales en el workflow
      if (currentWorkflow.nodes) {
        currentWorkflow.nodes.forEach((node: any) => {
          if (node.credentials) {
            // Actualizar credenciales según el tipo de nodo
            Object.keys(node.credentials).forEach((credType: string) => {
              switch (credType) {
                case 'whatsAppTriggerApi':
                  node.credentials[credType] = {
                    id: credentials.whatsAppTriggerApiId,
                    name: credentials.whatsAppTriggerApiName
                  };
                  break;
                case 'openAiApi':
                  node.credentials[credType] = {
                    id: credentials.openAiApiId,
                    name: credentials.openAiApiName
                  };
                  break;
                case 'httpHeaderAuth':
                  node.credentials[credType] = {
                    id: credentials.httpBearerAuthId,
                    name: credentials.httpBearerAuthName
                  };
                  break;
                case 'whatsAppApi':
                  node.credentials[credType] = {
                    id: credentials.whatsAppApiId,
                    name: credentials.whatsAppApiName
                  };
                  break;
              }
            });
          }
        });
      }

      // Actualizar el workflow en n8n
      const updateResponse = await fetch(`${this.n8nBaseUrl}/api/v1/workflows/${n8nWorkflowId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-N8N-API-KEY': this.n8nApiKey,
        },
        body: JSON.stringify({
          name: currentWorkflow.name,
          nodes: currentWorkflow.nodes,
          connections: currentWorkflow.connections,
          active: currentWorkflow.active,
          settings: currentWorkflow.settings
        }),
      });

      if (!updateResponse.ok) {
        throw new Error(`Error actualizando workflow: ${updateResponse.status}`);
      }

      console.log(`Workflow ${n8nWorkflowId} actualizado con nuevas credenciales`);
    } catch (error) {
      console.error(`Error actualizando workflow ${n8nWorkflowId}:`, error);
      throw error;
    }
  }
}
