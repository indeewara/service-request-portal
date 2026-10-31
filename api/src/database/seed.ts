import { pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import { Role } from '../auth/auth.types.js';
import { hashPassword } from '../auth/password.js';
import { User } from '../auth/user.entity.js';
import { databaseOptions } from './database.options.js';

// Demo accounts for local use only. Two customers so cross-customer access can be tested.
const DEMO_PASSWORD = 'Password123!';
const DEMO_USERS = [
  { email: 'alice@example.com', name: 'Alice Customer', role: Role.CUSTOMER },
  { email: 'bob@example.com', name: 'Bob Customer', role: Role.CUSTOMER },
  { email: 'staff@example.com', name: 'Sam Staff', role: Role.STAFF },
];

export async function seedUsers(dataSource: DataSource): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await dataSource
    .getRepository(User)
    .upsert(
      DEMO_USERS.map((u) => ({ ...u, passwordHash })),
      ['email'],
    );
}

// `npm run seed`: apply migrations, then upsert the demo users.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: rely on real environment variables.
  }
  const dataSource = await new DataSource({
    ...databaseOptions(),
    entities: [User],
  }).initialize();
  await dataSource.runMigrations();
  await seedUsers(dataSource);
  await dataSource.destroy();
  console.log(`Seeded ${DEMO_USERS.length} demo users`);
}
