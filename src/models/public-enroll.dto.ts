import { IsString, IsNotEmpty } from 'class-validator';

/**
 * Registro público a un curso (sin JWT). courseId va en la URL.
 */
export class PublicEnrollDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber!: string;
}
