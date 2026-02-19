import { Injectable } from '@nestjs/common';

/**
 * Service responsible for health check operations
 */
@Injectable()
export class HealthService {
  /**
   * Checks the health status of the application
   * @returns Object containing the health status
   */
  public checkHealth(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
} 