import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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

  /** Names for a page of requests, in one query. */
  async findNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const users = await this.users.find({
      where: { id: In(ids) },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }
}
