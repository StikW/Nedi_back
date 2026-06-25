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

  // WhatsApp / recordatorios: configuración solo desde panel admin (DynamoDB NotificationConfig).
  // REMINDER_INTERNAL_API_KEY se mantiene para proteger POST /reminders/run/* vía cron externo.

  reminderInternalApiKey: process.env.REMINDER_INTERNAL_API_KEY,
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

  // Logging (NestJS + archivos en logs/)
  logLevel: process.env.LOG_LEVEL || 'error,warn,log,debug',
  logToFile: process.env.LOG_TO_FILE !== 'false',
  logDir: process.env.LOG_DIR || 'logs',
  agentActivityLogMax: process.env.AGENT_ACTIVITY_LOG_MAX
    ? Number(process.env.AGENT_ACTIVITY_LOG_MAX)
    : 500,
}));
