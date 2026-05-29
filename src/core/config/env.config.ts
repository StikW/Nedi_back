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

  // WhatsApp Cloud API (Meta) - credenciales globales
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION,
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN,

  // WhatsApp - plantillas (legacy: si una espec\u00edfica falta, se usa esta)
  whatsappTemplateName: process.env.WHATSAPP_TEMPLATE_NAME,
  whatsappTemplateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE,
  whatsappTemplateBodyParams: process.env.WHATSAPP_TEMPLATE_BODY_PARAMS,

  // WhatsApp - plantillas espec\u00edficas
  whatsappWelcomeTemplateName: process.env.WHATSAPP_WELCOME_TEMPLATE_NAME,
  whatsappWelcomeTemplateLanguage: process.env.WHATSAPP_WELCOME_TEMPLATE_LANGUAGE,
  whatsappWelcomeTemplateBodyParams: process.env.WHATSAPP_WELCOME_TEMPLATE_BODY_PARAMS,
  whatsappDailyTemplateName: process.env.WHATSAPP_DAILY_TEMPLATE_NAME,
  whatsappDailyTemplateLanguage: process.env.WHATSAPP_DAILY_TEMPLATE_LANGUAGE,
  whatsappDailyTemplateBodyParams: process.env.WHATSAPP_DAILY_TEMPLATE_BODY_PARAMS,
  whatsappWeeklyTemplateName: process.env.WHATSAPP_WEEKLY_TEMPLATE_NAME,
  whatsappWeeklyTemplateLanguage: process.env.WHATSAPP_WEEKLY_TEMPLATE_LANGUAGE,
  whatsappWeeklyTemplateBodyParams: process.env.WHATSAPP_WEEKLY_TEMPLATE_BODY_PARAMS,

  // Recordatorios autom\u00e1ticos
  reminderInternalApiKey: process.env.REMINDER_INTERNAL_API_KEY,
  reminderCronEnabled: process.env.REMINDER_CRON_ENABLED,
  reminderCronTimezone: process.env.REMINDER_CRON_TIMEZONE,

  // Modo TEST (un solo cron que dispara las 3 plantillas a un tel\u00e9fono de prueba)
  reminderTestMode: process.env.REMINDER_TEST_MODE,
  reminderTestSchedule: process.env.REMINDER_TEST_SCHEDULE,
  reminderTestPhone: process.env.REMINDER_TEST_PHONE,

  // Modo PROD (2 cron jobs separados; welcome se dispara on-create)
  reminderDailyCronSchedule: process.env.REMINDER_DAILY_CRON_SCHEDULE,
  reminderWeeklyCronSchedule: process.env.REMINDER_WEEKLY_CRON_SCHEDULE,
}));
