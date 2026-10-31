import type { DataSourceOptions } from 'typeorm';
import { CreateUsers1761638400000 } from './migrations/1761638400000-CreateUsers.js';
import { CreateServiceRequests1761724800000 } from './migrations/1761724800000-CreateServiceRequests.js';
import { CreateAttachments1761811200000 } from './migrations/1761811200000-CreateAttachments.js';
import { CreateNotifications1761897600000 } from './migrations/1761897600000-CreateNotifications.js';

// Schema changes only through migrations; `synchronize` stays off.
export function databaseOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    synchronize: false,
    migrations: [
      CreateUsers1761638400000,
      CreateServiceRequests1761724800000,
      CreateAttachments1761811200000,
      CreateNotifications1761897600000,
    ],
  };
}
