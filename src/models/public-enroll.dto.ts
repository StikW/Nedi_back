import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { E164_PHONE_REGEX, E164_PHONE_VALIDATION_MESSAGE } from './phone-validation';

/**
 * Registro público a un curso (sin JWT). courseId va en la URL.
 */
export class PublicEnrollDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(E164_PHONE_REGEX, { message: E164_PHONE_VALIDATION_MESSAGE })
  phoneNumber!: string;
}
