import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiDefaultResponse,
  ApiTooManyRequestsResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ErrorBody } from '../common/error-body.dto.js';
import { AuthService } from './auth.service.js';
import { Public } from './decorators.js';
import { LoginDto, LoginResponse } from './login.dto.js';

@ApiTags('auth')
@ApiDefaultResponse({ type: ErrorBody, description: 'Error' })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Limited to LOGIN_RATE_LIMIT attempts (default 5) per minute per client IP. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @ApiTooManyRequestsResponse({ type: ErrorBody, description: 'Too many login attempts; see Retry-After' })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.auth.login(dto.email, dto.password);
  }
}
