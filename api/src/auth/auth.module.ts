import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { User } from './user.entity.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    // Applied to the login route only (see AuthController).
    // ponytail: in-memory counts, so each API instance limits separately; Redis storage or WAF rate rules when running several.
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        errorMessage: 'Too many login attempts. Try again in a minute.',
        throttlers: [
          { ttl: 60_000, limit: Number(process.env.LOGIN_RATE_LIMIT ?? 5) },
        ],
      }),
    }),
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret) throw new Error('JWT_SECRET is not set');
        return {
          secret,
          signOptions: { algorithm: 'HS256', expiresIn: '1h' },
          verifyOptions: { algorithms: ['HS256'] },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    UsersService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [UsersService],
})
export class AuthModule {}
