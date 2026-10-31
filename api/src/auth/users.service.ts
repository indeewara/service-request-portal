import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity.js';

/** Read-only user lookups for other modules, so they don't query the users table directly. */
@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  findContact(id: string): Promise<Pick<User, 'email' | 'name'> | null> {
    return this.users.findOne({
      where: { id },
      select: { email: true, name: true },
    });
  }
}
