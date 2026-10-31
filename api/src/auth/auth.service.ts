import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtPayload } from './auth.types.js';
import { hashPassword, verifyPassword } from './password.js';
import { User } from './user.entity.js';

// Checked when the email is unknown, so both failure paths take the same time.
const DUMMY_HASH = hashPassword('dummy-password');

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.users.findOne({
      where: { email },
      select: { id: true, name: true, role: true, passwordHash: true },
    });
    const valid = await verifyPassword(
      password,
      user?.passwordHash ?? (await DUMMY_HASH),
    );
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload: JwtPayload = { sub: user.id, role: user.role };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: { id: user.id, name: user.name, role: user.role },
    };
  }
}
