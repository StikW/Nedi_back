import { Injectable, Inject, ConflictException, NotFoundException, forwardRef } from '@nestjs/common';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';
import { User, USERS_TABLE, UserRole } from '../models/user.entity';
import { RegisterDto } from '../models/auth.dto';
import { UpdateUserDto, UserResponseDto } from '../models/user.dto';
import { CreateN8nCredentialDto } from '../models/n8n-credential.dto';
import { CreateWorkflowDto } from '../models/workflow.dto';
import { PaginationDto, PaginatedResponseDto } from '../models/pagination.dto';
import { N8nCredentialService } from './n8n-credential.service';
import { WorkflowService } from './workflow.service';

/**
 * Service responsible for user operations
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
    @Inject(forwardRef(() => N8nCredentialService))
    private readonly n8nCredentialService?: N8nCredentialService,
    @Inject(forwardRef(() => WorkflowService))
    private readonly workflowService?: WorkflowService,
  ) {}

  /**
   * Creates a new user
   * @param registerDto User registration data
   * @returns Created user without password
   */
  public async createUser(registerDto: RegisterDto): Promise<Omit<User, 'password'>> {
    // Check if user already exists
    const existingUser = await this.findByEmail(registerDto.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const now = new Date().toISOString();
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user: User = {
      id: uuidv4(),
      email: registerDto.email,
      password: hashedPassword,
      name: registerDto.name,
      role: registerDto.role || UserRole.STUDENT, // Default role is STUDENT
      createdAt: now,
      updatedAt: now,
      // Campos específicos para instructores
      clientIdApp: registerDto.clientIdApp,
      clientSecretApp: registerDto.clientSecretApp,
      accessToken: registerDto.accessToken,
      businessAccountId: registerDto.businessAccountId,
      apiKey: registerDto.apiKey,
    };

    await this.dynamoClient.send(
      new PutCommand({
        TableName: USERS_TABLE,
        Item: user,
      }),
    );

    // Si el usuario es instructor, crear las credenciales de WhatsApp y workflow automáticamente
    if (user.role === UserRole.INSTRUCTOR) {
      const credentials = await this.createInstructorCredentials(user);
      await this.createInstructorWorkflow(user, credentials);
    }

    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  /**
   * Finds a user by email
   * @param email User's email
   * @returns User if found, null otherwise
   */
  public async findByEmail(email: string): Promise<User | null> {
    const result = await this.dynamoClient.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: 'email-index',
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: {
          ':email': email,
        },
        Limit: 1,
      }),
    );

    return (result.Items?.[0] as User) || null;
  }

  /**
   * Finds a user by ID
   * @param id User's ID
   * @returns User if found
   * @throws NotFoundException if user not found
   */
  public async findById(id: string): Promise<User> {
    const result = await this.dynamoClient.send(
      new GetCommand({
        TableName: USERS_TABLE,
        Key: { id },
      }),
    );

    if (!result.Item) {
      throw new NotFoundException('User not found');
    }

    return result.Item as User;
  }

  /**
   * Validates a user's password
   * @param user User to validate
   * @param password Password to validate
   * @returns True if password is valid
   */
  public async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password);
  }

  /**
   * Updates a user's information
   * @param userId User's ID
   * @param updateDto Data to update
   * @returns Updated user without password
   */
  public async updateUser(userId: string, updateDto: UpdateUserDto): Promise<UserResponseDto> {
    // First check if user exists
    const user = await this.findById(userId);
    
    // Check if email is being updated and if it already exists
    if (updateDto.email && updateDto.email !== user.email) {
      const existingUser = await this.findByEmail(updateDto.email);
      if (existingUser) {
        throw new ConflictException('User with this email already exists');
      }
    }

    const updateExpression: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    // Build update expression dynamically based on provided fields
    if (updateDto.email !== undefined) {
      updateExpression.push('#email = :email');
      expressionAttributeNames['#email'] = 'email';
      expressionAttributeValues[':email'] = updateDto.email;
    }

    if (updateDto.password !== undefined) {
      const hashedPassword = await bcrypt.hash(updateDto.password, 10);
      updateExpression.push('#password = :password');
      expressionAttributeNames['#password'] = 'password';
      expressionAttributeValues[':password'] = hashedPassword;
    }

    if (updateDto.name !== undefined) {
      updateExpression.push('#name = :name');
      expressionAttributeNames['#name'] = 'name';
      expressionAttributeValues[':name'] = updateDto.name;
    }

    if (updateDto.role !== undefined) {
      updateExpression.push('#role = :role');
      expressionAttributeNames['#role'] = 'role';
      expressionAttributeValues[':role'] = updateDto.role;
    }

    if (updateDto.clientIdApp !== undefined) {
      updateExpression.push('#clientIdApp = :clientIdApp');
      expressionAttributeNames['#clientIdApp'] = 'clientIdApp';
      expressionAttributeValues[':clientIdApp'] = updateDto.clientIdApp;
    }

    if (updateDto.clientSecretApp !== undefined) {
      updateExpression.push('#clientSecretApp = :clientSecretApp');
      expressionAttributeNames['#clientSecretApp'] = 'clientSecretApp';
      expressionAttributeValues[':clientSecretApp'] = updateDto.clientSecretApp;
    }

    if (updateDto.businessAccountId !== undefined) {
      updateExpression.push('#businessAccountId = :businessAccountId');
      expressionAttributeNames['#businessAccountId'] = 'businessAccountId';
      expressionAttributeValues[':businessAccountId'] = updateDto.businessAccountId;
    }

    if (updateDto.accessToken !== undefined) {
      updateExpression.push('#accessToken = :accessToken');
      expressionAttributeNames['#accessToken'] = 'accessToken';
      expressionAttributeValues[':accessToken'] = updateDto.accessToken;
    }

    if (updateDto.apiKey !== undefined) {
      updateExpression.push('#apiKey = :apiKey');
      expressionAttributeNames['#apiKey'] = 'apiKey';
      expressionAttributeValues[':apiKey'] = updateDto.apiKey;
    }

    // Always update the updatedAt timestamp
    updateExpression.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = new Date().toISOString();

    await this.dynamoClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { id: userId },
        UpdateExpression: `SET ${updateExpression.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      }),
    );

    // Si el usuario es instructor y se actualizaron campos de credenciales, actualizar en n8n
    if (user.role === UserRole.INSTRUCTOR && this.hasCredentialFieldsChanged(updateDto)) {
      await this.updateInstructorCredentialsInN8n(userId, updateDto);
    }

    // Return updated user without password
    const updatedUser = await this.findById(userId);
    const { password, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword as UserResponseDto;
  }

  /**
   * Lists all users (Admin only)
   * @param limit Maximum number of users to return
   * @param lastEvaluatedKey Key for pagination
   * @returns List of users without passwords
   */
  public async listUsers(limit: number = 50, lastEvaluatedKey?: any): Promise<{
    users: UserResponseDto[];
    lastEvaluatedKey?: any;
  }> {
    const result = await this.dynamoClient.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        Limit: limit,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    const users = (result.Items as User[] || []).map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword as UserResponseDto;
    });

    return {
      users,
      lastEvaluatedKey: result.LastEvaluatedKey,
    };
  }

  /**
   * Lists all users with cursor-based pagination (Admin only)
   * @param paginationDto Pagination parameters
   * @returns List of users without passwords
   */
  public async listUsersPaginated(paginationDto: PaginationDto): Promise<PaginatedResponseDto<UserResponseDto>> {
    const { cursor, sortOrder = 'asc' } = paginationDto;
    
    // Fixed limit of 10 items per page
    const limit = 10;
    
    // Parse cursor if provided
    let exclusiveStartKey: any = undefined;
    if (cursor) {
      try {
        const cursorData = JSON.parse(Buffer.from(cursor, 'base64').toString());
        exclusiveStartKey = {
          id: cursorData.id
        };
      } catch (error) {
        // Invalid cursor provided, starting from beginning
      }
    }

    const result = await this.dynamoClient.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        Limit: limit + 1, // Get one extra to check if there's a next page
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const allItems = (result.Items as User[] || []);
    const users = allItems.slice(0, limit).map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword as UserResponseDto;
    });
    
    // Use LastEvaluatedKey to determine if there's a next page
    const hasNext = !!result.LastEvaluatedKey;
    
    // Generate next cursor if there's a next page
    let nextCursor: string | undefined;
    if (hasNext && users.length > 0) {
      const lastUser = users[users.length - 1];
      const cursorData = {
        id: lastUser.id
      };
      nextCursor = Buffer.from(JSON.stringify(cursorData)).toString('base64');
    }

    return {
      data: users,
      pagination: {
        limit,
        hasNext,
        nextCursor,
        sortOrder
      }
    };
  }

  /**
   * Search users by email (Admin only)
   * @param email Email to search for
   * @returns List of users matching the email search
   */
  public async searchUsersByEmail(email: string): Promise<UserResponseDto[]> {
    const result = await this.dynamoClient.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: 'contains(email, :email)',
        ExpressionAttributeValues: {
          ':email': email
        }
      }),
    );

    const users = (result.Items as User[] || []).map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword as UserResponseDto;
    });

    return users;
  }

  /**
   * Search users by email with pagination (Admin only)
   * @param email Email to search for
   * @param paginationDto Pagination parameters
   * @returns List of users matching the email search
   */
  public async searchUsersByEmailPaginated(
    email: string, 
    paginationDto: PaginationDto
  ): Promise<PaginatedResponseDto<UserResponseDto>> {
    const { cursor, sortOrder = 'asc' } = paginationDto;
    
    // Fixed limit of 1 items per page
    const limit = 10;
    
    // Parse cursor if provided
    let exclusiveStartKey: any = undefined;
    if (cursor) {
      try {
        const cursorData = JSON.parse(Buffer.from(cursor, 'base64').toString());
        exclusiveStartKey = {
          id: cursorData.id
        };
      } catch (error) {
        // Invalid cursor provided, starting from beginning
      }
    }

    const result = await this.dynamoClient.send(
      new ScanCommand({
        TableName: USERS_TABLE,
        FilterExpression: 'contains(email, :email)',
        ExpressionAttributeValues: {
          ':email': email
        },
        Limit: limit + 1, // Get one extra to check if there's a next page
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const allItems = (result.Items as User[] || []);
    const users = allItems.slice(0, limit).map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword as UserResponseDto;
    });
    
    // Use LastEvaluatedKey to determine if there's a next page
    const hasNext = !!result.LastEvaluatedKey;
    
    // Generate next cursor if there's a next page
    let nextCursor: string | undefined;
    if (hasNext && users.length > 0) {
      const lastUser = users[users.length - 1];
      const cursorData = {
        id: lastUser.id
      };
      nextCursor = Buffer.from(JSON.stringify(cursorData)).toString('base64');
    }

    return {
      data: users,
      pagination: {
        limit,
        hasNext,
        nextCursor,
        sortOrder
      }
    };
  }

  /**
   * Creates WhatsApp credentials for an instructor
   * @param instructor Instructor user
   * @returns Object with credential IDs and names
   */
  private async createInstructorCredentials(instructor: User): Promise<{
    whatsAppTriggerApiId: string;
    whatsAppTriggerApiName: string;
    openAiApiId: string;
    openAiApiName: string;
    httpBearerAuthId: string;
    httpBearerAuthName: string;
    whatsAppApiId: string;
    whatsAppApiName: string;
  }> {
    if (!this.n8nCredentialService) {
      console.warn('N8nCredentialService not available, skipping credential creation');
      return {
        whatsAppTriggerApiId: '',
        whatsAppTriggerApiName: '',
        openAiApiId: '',
        openAiApiName: '',
        httpBearerAuthId: '',
        httpBearerAuthName: '',
        whatsAppApiId: '',
        whatsAppApiName: ''
      };
    }

    try {
      // Crear credencial WhatsApp Trigger API
      const whatsAppTriggerCredential: CreateN8nCredentialDto = {
        name: `${instructor.id}-whatsAppTriggerApi`,
        type: 'whatsAppTriggerApi',
        id_n8n: '', // Se generará automáticamente en n8n
        clientId: instructor.clientIdApp || '',
        clientSecret: instructor.clientSecretApp || ''
      };

      // Crear credencial WhatsApp API
      const whatsAppApiCredential: CreateN8nCredentialDto = {
        name: `${instructor.id}-whatsAppApi`,
        type: 'whatsAppApi',
        id_n8n: '', // Se generará automáticamente en n8n
        accessToken: instructor.accessToken || '',
        businessAccountId: instructor.businessAccountId || ''
      };

      // Crear credencial HTTP Header Auth
      const httpHeaderAuthCredential: CreateN8nCredentialDto = {
        name: `${instructor.id}-httpHeaderAuth`,
        type: 'httpHeaderAuth',
        id_n8n: '', // Se generará automáticamente en n8n
        value: 'Bearer ' + instructor.accessToken || ''
      };

      // Crear credencial OpenAI API
      const openAiApiCredential: CreateN8nCredentialDto = {
        name: `${instructor.id}-openAiApi`,
        type: 'openAiApi',
        id_n8n: '', // Se generará automáticamente en n8n
        apiKey: instructor.apiKey || ''
        
      };

      // Crear credenciales en n8n y obtener los IDs
      const [whatsAppTriggerResult, whatsAppApiResult, httpHeaderAuthResult, openAiApiResult] = await Promise.all([
        this.n8nCredentialService.create(whatsAppTriggerCredential, instructor),
        this.n8nCredentialService.create(whatsAppApiCredential, instructor),
        this.n8nCredentialService.create(httpHeaderAuthCredential, instructor),
        this.n8nCredentialService.create(openAiApiCredential, instructor)
      ]);

      console.log(`Credenciales de WhatsApp creadas para instructor: ${instructor.id}`);

      // Retornar los IDs y nombres de las credenciales
      return {
        whatsAppTriggerApiId: whatsAppTriggerResult.id_n8n || '',
        whatsAppTriggerApiName: whatsAppTriggerResult.name,
        openAiApiId: openAiApiResult.id_n8n || '',
        openAiApiName: openAiApiResult.name,
        httpBearerAuthId: httpHeaderAuthResult.id_n8n || '',
        httpBearerAuthName: httpHeaderAuthResult.name,
        whatsAppApiId: whatsAppApiResult.id_n8n || '',
        whatsAppApiName: whatsAppApiResult.name
      };
    } catch (error) {
      console.error(`Error creando credenciales para instructor ${instructor.id}:`, error);
      // Retornar valores vacíos en caso de error
      return {
        whatsAppTriggerApiId: '',
        whatsAppTriggerApiName: '',
        openAiApiId: '',
        openAiApiName: '',
        httpBearerAuthId: '',
        httpBearerAuthName: '',
        whatsAppApiId: '',
        whatsAppApiName: ''
      };
    }
  }

  /**
   * Checks if any credential-related fields have been changed
   * @param updateDto Update data
   * @returns True if credential fields were changed
   */
  private hasCredentialFieldsChanged(updateDto: UpdateUserDto): boolean {
    return updateDto.clientIdApp !== undefined ||
           updateDto.clientSecretApp !== undefined ||
           updateDto.accessToken !== undefined ||
           updateDto.businessAccountId !== undefined;
  }

  /**
   * Updates instructor credentials in n8n when user data changes
   * @param userId User ID
   * @param updateDto Update data
   */
  private async updateInstructorCredentialsInN8n(userId: string, updateDto: UpdateUserDto): Promise<void> {
    if (!this.n8nCredentialService) {
      console.warn('N8nCredentialService not available, skipping credential update');
      return;
    }

    try {
      // Obtener las credenciales del instructor
      const credentials = await this.n8nCredentialService.findAllByInstructor(userId);
      
      // Actualizar credencial WhatsApp Trigger API si existe
      const whatsAppTriggerCredential = credentials.find(c => c.type === 'whatsAppTriggerApi');
      if (whatsAppTriggerCredential && (updateDto.clientIdApp !== undefined || updateDto.clientSecretApp !== undefined)) {
        await this.n8nCredentialService.update(whatsAppTriggerCredential.id, {
          clientId: updateDto.clientIdApp,
          clientSecret: updateDto.clientSecretApp
        }, userId);
      }

      // Actualizar credencial WhatsApp API si existe
      const whatsAppApiCredential = credentials.find(c => c.type === 'whatsAppApi');
      if (whatsAppApiCredential && (updateDto.accessToken !== undefined || updateDto.businessAccountId !== undefined)) {
        await this.n8nCredentialService.update(whatsAppApiCredential.id, {
          accessToken: updateDto.accessToken,
          businessAccountId: updateDto.businessAccountId
        }, userId);
      }

      // Actualizar credencial HTTP Header Auth si existe
      const httpHeaderAuthCredential = credentials.find(c => c.type === 'httpHeaderAuth');
      if (httpHeaderAuthCredential && (updateDto.accessToken !== undefined)) {
        await this.n8nCredentialService.update(httpHeaderAuthCredential.id, {
          value: 'Bearer ' + updateDto.accessToken
        }, userId);
      }

      // Actualizar credencial OpenAI API si existe
      const openAiApiCredential = credentials.find(c => c.type === 'openAiApi');
      if (openAiApiCredential && (updateDto.apiKey !== undefined)) {
        await this.n8nCredentialService.update(openAiApiCredential.id, {
          apiKey: updateDto.apiKey || ''
        }, userId);
      }

      console.log(`Credenciales de WhatsApp actualizadas para instructor: ${userId}`);
    } catch (error) {
      console.error(`Error actualizando credenciales para instructor ${userId}:`, error);
      // No lanzamos la excepción para no interrumpir la actualización del usuario
    }
  }

  /**
   * Creates a workflow for an instructor
   * @param instructor Instructor user
   */
  private async createInstructorWorkflow(
    instructor: User, 
    credentials: {
      whatsAppTriggerApiId: string;
      whatsAppTriggerApiName: string;
      openAiApiId: string;
      openAiApiName: string;
      httpBearerAuthId: string;
      httpBearerAuthName: string;
      whatsAppApiId: string;
      whatsAppApiName: string;
    }
  ): Promise<void> {
    if (!this.workflowService) {
      console.warn('WorkflowService not available, skipping workflow creation');
      return;
    }

    try {
      // Crear workflow para el instructor
      const workflowDto: CreateWorkflowDto = {
        name: `${instructor.name} - Workflow`,
        description: `Workflow para el instructor ${instructor.name}`,
        definition: {},
        tags: [],
        active: false, // Inicialmente activo
        // Pasar las credenciales para el template
        credentials: credentials
      };

      await this.workflowService.create(workflowDto, instructor);
      console.log(`Workflow creado para instructor: ${instructor.id}`);
    } catch (error) {
      console.error(`Error creando workflow para instructor ${instructor.id}:`, error);
      // No lanzamos la excepción para no interrumpir el registro del usuario
    }
  }
} 