import { IsString, IsNotEmpty, IsPhoneNumber, IsOptional } from 'class-validator';

export class CreateStudentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsPhoneNumber() // Acepta cualquier número internacional válido
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
  @IsPhoneNumber() // Acepta cualquier número internacional válido
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