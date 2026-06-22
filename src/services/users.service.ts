import { Injectable, Inject, ConflictException, NotFoundException, BadRequestException, forwardRef } from '@nestjs/common';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';
import { User, USERS_TABLE, UserRole } from '../models/user.entity';
import { RegisterDto } from '../models/auth.dto';
import { UpdateUserDto, UserResponseDto, DeleteUserResultDto } from '../models/user.dto';
import { PaginationDto, PaginatedResponseDto } from '../models/pagination.dto';
import { CourseService } from './course.service';
import { EvolutionAdminService } from './agent/evolution-admin.service';
import { StudentProgressCleanupService } from './student-progress-cleanup.service';

/**
 * Service responsible for user operations
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject('DYNAMODB_CLIENT')
    private readonly dynamoClient: DynamoDBDocumentClient,
    @Inject(forwardRef(() => CourseService))
    private readonly courseService: CourseService,
    @Inject(forwardRef(() => EvolutionAdminService))
    private readonly evolutionAdmin: EvolutionAdminService,
    private readonly progressCleanup: StudentProgressCleanupService,
  ) {}

  /**
   * Normaliza un n\u00famero a formato E.164 sin el prefijo "+" (consistente con el
   * resto del sistema y con lo que espera Meta Graph API).
   */
  private normalizePhoneNumber(phoneNumber: string): string {
    return (phoneNumber || '').replace(/[^0-9]/g, '');
  }

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
      role: registerDto.role || UserRole.STUDENT,
      isActive: registerDto.isActive !== undefined ? registerDto.isActive : true,
      phoneNumber: registerDto.phoneNumber
        ? this.normalizePhoneNumber(registerDto.phoneNumber)
        : undefined,
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
   * Busca un instructor por el nombre de su instancia de Evolution.
   * Usado por el agente para resolver el tenant en cada webhook entrante.
   *
   * Las instancias Nedi siguen el patron `nedi_{userId}`; se resuelve por id
   * directo (O(1)). El Scan con filtro queda como respaldo para nombres custom.
   */
  public async findByEvolutionInstance(instance: string): Promise<User | null> {
    if (!instance) return null;

    const derivedId = this.instructorIdFromEvolutionInstance(instance);
    if (derivedId) {
      try {
        const user = await this.findById(derivedId);
        if (user.role === UserRole.INSTRUCTOR || user.role === UserRole.ADMIN) {
          if (user.evolutionInstance !== instance) {
            await this.updateEvolutionConfig(derivedId, { evolutionInstance: instance });
          }
          return user;
        }
      } catch {
        // El uuid del nombre no corresponde a un usuario; continuar con scan
      }
    }

    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoClient.send(
        new ScanCommand({
          TableName: USERS_TABLE,
          FilterExpression: 'evolutionInstance = :instance',
          ExpressionAttributeValues: { ':instance': instance },
          ExclusiveStartKey: lastKey,
        }),
      );
      if (result.Items?.[0]) return result.Items[0] as User;
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return null;
  }

  /** Extrae el userId de instancias con formato `nedi_{uuid}`. */
  private instructorIdFromEvolutionInstance(instance: string): string | null {
    const match = /^nedi_([0-9a-f-]{36})$/i.exec(instance.trim());
    return match?.[1] ?? null;
  }

  /**
   * Actualiza la configuracion de Evolution (numero de capacitacion) de un instructor.
   */
  public async updateEvolutionConfig(
    userId: string,
    config: Partial<
      Pick<User, 'evolutionInstance' | 'evolutionApiKey' | 'evolutionNumber' | 'evolutionStatus'>
    >,
  ): Promise<void> {
    const updateExpression: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, any> = {};

    for (const [key, value] of Object.entries(config)) {
      if (value === undefined) continue;
      updateExpression.push(`#${key} = :${key}`);
      names[`#${key}`] = key;
      values[`:${key}`] = value;
    }

    if (updateExpression.length === 0) return;

    updateExpression.push('#updatedAt = :updatedAt');
    names['#updatedAt'] = 'updatedAt';
    values[':updatedAt'] = new Date().toISOString();

    await this.dynamoClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { id: userId },
        UpdateExpression: `SET ${updateExpression.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }

  /**
   * Copia el número vinculado en Evolution al campo `phoneNumber` del instructor.
   * Ese valor alimenta la plantilla de bienvenida (`instructor_phone`).
   */
  public async syncInstructorPhoneFromEvolution(
    userId: string,
    evolutionNumber: string | null | undefined,
  ): Promise<void> {
    const now = new Date().toISOString();

    if (evolutionNumber && evolutionNumber.trim()) {
      const normalized = this.normalizePhoneNumber(evolutionNumber);
      await this.dynamoClient.send(
        new UpdateCommand({
          TableName: USERS_TABLE,
          Key: { id: userId },
          UpdateExpression: 'SET #phoneNumber = :phoneNumber, #updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#phoneNumber': 'phoneNumber',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':phoneNumber': normalized,
            ':updatedAt': now,
          },
        }),
      );
      return;
    }

    await this.dynamoClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { id: userId },
        UpdateExpression: 'REMOVE #phoneNumber SET #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#phoneNumber': 'phoneNumber',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':updatedAt': now,
        },
      }),
    );
  }

  /** Excluye campos sensibles antes de enviar el usuario al cliente. */
  private toPublicUser(user: User): UserResponseDto {
    const { password, evolutionApiKey, ...rest } = user;
    return rest as UserResponseDto;
  }

  /**
   * Devuelve el perfil del usuario autenticado (sin password ni evolutionApiKey).
   */
  public async getMyProfile(userId: string): Promise<UserResponseDto> {
    const user = await this.findById(userId);
    return this.toPublicUser(user);
  }

  /**
   * Permite al usuario autenticado actualizar SU PROPIO perfil.
   *
   * Por seguridad, este m\u00e9todo descarta los campos sensibles que solo un
   * admin puede modificar (role, credenciales de n8n/WhatsApp del instructor, etc.).
   * Los \u00fanicos campos editables por self-service son:
   *   - name
   *   - email
   *   - phoneNumber  (solo lectura: se sincroniza desde Evolution al conectar WhatsApp)
   *
   * Para cambiar la password se sigue usando POST /auth/change-password.
   */
  public async updateMyProfile(
    userId: string,
    updateDto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    const sanitized: UpdateUserDto = {
      name: updateDto.name,
      email: updateDto.email,
    };
    return this.updateUser(userId, sanitized);
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

    if (updateDto.isActive !== undefined) {
      updateExpression.push('#isActive = :isActive');
      expressionAttributeNames['#isActive'] = 'isActive';
      expressionAttributeValues[':isActive'] = updateDto.isActive;
    }

    if (updateDto.phoneNumber !== undefined) {
      updateExpression.push('#phoneNumber = :phoneNumber');
      expressionAttributeNames['#phoneNumber'] = 'phoneNumber';
      expressionAttributeValues[':phoneNumber'] = updateDto.phoneNumber
        ? this.normalizePhoneNumber(updateDto.phoneNumber)
        : null;
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

    // Return updated user without sensitive fields
    const updatedUser = await this.findById(userId);
    return this.toPublicUser(updatedUser);
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
   * Elimina un usuario y, si es instructor, sus cursos, estados del agente e instancia Evolution.
   */
  public async deleteUser(userId: string, actingAdminId?: string): Promise<DeleteUserResultDto> {
    if (actingAdminId && actingAdminId === userId) {
      throw new BadRequestException('No puedes eliminar tu propia cuenta');
    }

    const user = await this.findById(userId);
    let deletedCoursesCount = 0;
    let deletedAgentStatesCount = 0;
    let evolutionInstanceDeleted = false;
    const evolutionInstance =
      user.evolutionInstance ||
      (user.role === UserRole.INSTRUCTOR ? `nedi_${user.id}` : undefined);

    if (user.role === UserRole.INSTRUCTOR) {
      const courses = await this.courseService.findAllByInstructor(userId);
      for (const course of courses) {
        await this.courseService.delete(course.id, userId);
        deletedCoursesCount++;
      }

      if (evolutionInstance) {
        deletedAgentStatesCount = await this.progressCleanup.purgeByEvolutionInstance(
          evolutionInstance,
        );
        evolutionInstanceDeleted = await this.evolutionAdmin.deleteInstance(evolutionInstance);
      }
    }

    await this.dynamoClient.send(
      new DeleteCommand({
        TableName: USERS_TABLE,
        Key: { id: userId },
      }),
    );

    return {
      userId,
      role: user.role,
      deletedCoursesCount,
      deletedAgentStatesCount,
      evolutionInstance,
      evolutionInstanceDeleted,
    };
  }
} 