import { Controller, Get } from '@nestjs/common';
import { HealthService } from '../services/health.service';

/**
 * Controller responsible for health check endpoints
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Endpoint to check the health status of the application
   * @returns Health status information
   */
  @Get()
  public checkHealth() {
    return this.healthService.checkHealth();
  }

  /**
   * Smoke test endpoint for basic connectivity testing
   * @returns Simple success message
   */
  @Get('test')
  public smokeTest() {
    return { message: 'Health check endpoint is working' };
  }
} 