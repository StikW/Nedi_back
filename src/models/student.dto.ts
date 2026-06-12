import { IsString, IsNotEmpty, IsOptional, Matches } from 'class-validator';
import { E164_PHONE_REGEX, E164_PHONE_VALIDATION_MESSAGE } from './phone-validation';

export class CreateStudentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @Matches(E164_PHONE_REGEX, { message: E164_PHONE_VALIDATION_MESSAGE })
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  courseId: string;
}

export class UpdateStudentDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  @Matches(E164_PHONE_REGEX, { message: E164_PHONE_VALIDATION_MESSAGE })
  phoneNumber?: string;
}

export class StudentResponseDto {
  id: string;
  name: string;
  phoneNumber: string;
  courseId: string;
  instructorId: string;
  enrolledAt: string;
  updatedAt: string;
}

export class ImportStudentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @Matches(E164_PHONE_REGEX, { message: E164_PHONE_VALIDATION_MESSAGE })
  phoneNumber: string;
}

export class ImportStudentsResponseDto {
  success: number;
  failed: number;
  errors: Array<{
    row: number;
    name: string;
    phoneNumber: string;
    error: string;
  }>;
  createdStudents: StudentResponseDto[];
}

export class ResetStudentProgressResponseDto {
  studentId: string;
  message: string;
  purged: {
    moduleProgress: number;
    questionProgress: number;
    agentState: number;
  };
}