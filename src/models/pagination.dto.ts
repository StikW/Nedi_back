import { IsOptional, IsNumber, Min, Max, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Pagination query parameters DTO
 */
export class PaginationDto {
  /** Cursor for pagination (lastEvaluatedKey from previous response) */
  @IsOptional()
  cursor?: string;

  /** Sort order */
  @IsOptional()
  sortOrder?: 'asc' | 'desc';

  /** Page number (for page-based pagination) */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  /** Items per page (for page-based pagination) */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Filtro de búsqueda (nombre o teléfono) */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

/**
 * Paginated response DTO
 */
export class PaginatedResponseDto<T> {
  /** Array of items */
  data: T[];

  /** Pagination metadata */
  pagination: {
    /** Number of items per page */
    limit: number;
    /** Whether there is a next page */
    hasNext: boolean;
    /** Cursor for next page (lastEvaluatedKey) */
    nextCursor?: string;
    /** Sort order used */
    sortOrder: 'asc' | 'desc';
  };
}
