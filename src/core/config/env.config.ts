import { registerAs } from '@nestjs/config';

export default registerAs('env', () => ({
  // AWS Configuration
  awsRegion: process.env.AWS_REGION,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  
  // S3 Configuration
  s3Bucket: process.env.S3_BUCKET,
  s3BucketModules: process.env.S3_BUCKET_MODULES,
  
  // JWT Configuration
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN,
  
  // N8N Configuration
  n8nBaseUrl: process.env.N8N_BASE_URL,
  n8nApiKey: process.env.N8N_API_KEY,
}));
