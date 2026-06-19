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

  // ===== Agente Nedi (microlearning por WhatsApp / Evolution) =====
  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiChatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-5-mini',
  openaiClassifierModel: process.env.OPENAI_CLASSIFIER_MODEL || process.env.OPENAI_CHAT_MODEL || 'gpt-5-mini',
  openaiTranscribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe',
  openaiVisionModel: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
  openaiTtsModel: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
  openaiTtsVoice: process.env.OPENAI_TTS_VOICE || 'alloy',
  openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  // n8n usa text-embedding-3-small con dimensions=512; el indice Pinecone `courses` es 512
  openaiEmbeddingDimensions: process.env.OPENAI_EMBEDDING_DIMENSIONS
    ? Number(process.env.OPENAI_EMBEDDING_DIMENSIONS)
    : 512,

  // Pinecone (RAG): un solo indice, namespace = courseId, metadata module = moduleId
  pineconeApiKey: process.env.PINECONE_API_KEY,
  pineconeIndex: process.env.PINECONE_INDEX || 'courses',

  // Evolution API (servidor global; instancia/apikey por instructor van en User)
  evolutionServerUrl: process.env.EVOLUTION_SERVER_URL,
  evolutionAdminApiKey: process.env.EVOLUTION_ADMIN_API_KEY,

  // URL publica del webhook del agente (para configurar el webhook de cada instancia)
  agentWebhookPublicUrl: process.env.AGENT_WEBHOOK_PUBLIC_URL,
  // Segundos de buffer/debounce de mensajes entrantes
  agentBufferSeconds: process.env.AGENT_BUFFER_SECONDS ? Number(process.env.AGENT_BUFFER_SECONDS) : 5,
  // Minutos sin actividad antes de reenviar conversacion inicial (n8n: 20 min en Redis)
  agentSessionTimeoutMinutes: process.env.AGENT_SESSION_TIMEOUT_MINUTES
    ? Number(process.env.AGENT_SESSION_TIMEOUT_MINUTES)
    : 20,
  // Duración de la burbuja de presencia justo antes de enviar (ms)
  agentTypingDelayMs: process.env.AGENT_TYPING_DELAY_MS
    ? Number(process.env.AGENT_TYPING_DELAY_MS)
    : 1200,
}));
