/** E.164 con `+` obligatorio al inicio y sin espacios en ninguna posición. */
export const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;

export const E164_PHONE_VALIDATION_MESSAGE =
  'El teléfono debe comenzar con +, en formato E.164 y sin espacios (ej: +573001234567)';

export function isValidE164Phone(phoneNumber: string): boolean {
  return E164_PHONE_REGEX.test(phoneNumber);
}

export function hasPhoneWhitespace(phoneNumber: string): boolean {
  return /\s/.test(phoneNumber);
}
