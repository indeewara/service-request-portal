import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Role } from './auth.types.js';

export class LoginDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @MaxLength(200)
  @IsNotEmpty()
  @IsString()
  password: string;
}

export class LoginUser {
  id: string;
  name: string;
  role: Role;
}

export class LoginResponse {
  /** JWT, valid for 1 hour. Send as `Authorization: Bearer <token>`. */
  accessToken: string;
  user: LoginUser;
}
