import { User } from '../../models/user.entity';

/**
 * Configuracion de Evolution resuelta para un instructor (tenant).
 */
export interface EvolutionConfig {
  /** URL base del servidor Evolution (global) */
  serverUrl: string;
  /** Nombre de la instancia del instructor */
  instance: string;
  /** API key principal de la instancia */
  apiKey: string;
  /** Claves alternativas (webhook, live, guardada) para reintentos de envio */
  apiKeys?: string[];
}

/**
 * Contexto de tenant resuelto a partir del webhook entrante.
 */
export interface TenantContext {
  instructor: User;
  evolution: EvolutionConfig;
  /** Numero vinculado en Evolution (ownerJid), aunque aun no este en BD */
  liveOwnerNumber?: string;
}

/** Tipos de flujo de la conversacion (estado por telefono). */
export type ConversationFlow = 'conversacion' | 'preguntas';

/** Rutas que devuelve el clasificador de intencion. */
export type IntentRoute =
  | 'AI_Conversacion'
  | 'AI_Preguntas'
  | 'AI_Respuestas'
  | 'AI_Explicar';

/**
 * Mensaje entrante ya normalizado (equivalente al nodo `parser` de n8n).
 */
export interface ParsedIncomingMessage {
  /** Telefono del estudiante (E.164 sin +) */
  phoneNumber: string;
  /** Texto del mensaje (vacio si es audio/imagen sin texto) */
  message: string;
  /** Tipo de mensaje de Evolution: conversation | audioMessage | imageMessage | ... */
  messageType: string;
  /** Nombre de la instancia que recibio el mensaje */
  instance: string;
  /** API key enviada por Evolution */
  apikey: string;
  /** id del mensaje (para idempotencia) */
  messageId?: string;
  /** JID completo para responder (p. ej. 57300...@s.whatsapp.net) */
  recipientJid: string;
  /** remoteJid crudo del webhook (puede ser @lid) */
  remoteJid: string;
  /** remoteJidAlt del webhook (telefono real cuando remoteJid es @lid) */
  remoteJidAlt: string;
  /** JID de respuesta exacto como n8n: remoteJid si tiene @s.whatsapp.net, si no remoteJidAlt */
  replyToJid: string;
  /** senderPn del webhook (telefono cuando solo llega @lid) */
  senderPn?: string;
  /** payload crudo (para descargar media) */
  raw: any;
}
