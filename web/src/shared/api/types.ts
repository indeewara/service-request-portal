// Mirrors the API's response types (see /docs on the API). Shared by every feature.

export type Role = 'CUSTOMER' | 'STAFF';
export type RequestStatus = 'NEW' | 'IN_REVIEW' | 'RESOLVED' | 'REJECTED';
export type RequestCategory = 'DAMAGED_DELIVERY' | 'WRONG_ITEM' | 'QUALITY_ISSUE' | 'OTHER';
export type ImageContentType = 'image/jpeg' | 'image/png';

export interface ServiceRequest {
  id: string;
  customerId: string;
  orderNumber: string;
  category: RequestCategory;
  description: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StatusChange {
  id: string;
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus;
  changedBy: string;
  changedAt: string;
}

export interface RequestDetails extends ServiceRequest {
  history: StatusChange[];
}

export interface RequestPage {
  items: ServiceRequest[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Photo {
  id: string;
  contentType: ImageContentType;
  sizeBytes: number;
  url: string;
  createdAt: string;
}

export interface UploadTarget {
  attachmentId: string;
  url: string;
  fields: Record<string, string>;
  expiresIn: number;
}

export interface LoginResult {
  accessToken: string;
  user: { id: string; name: string; role: Role };
}

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: string[];
  correlationId?: string;
}

export interface StaffFilters {
  status?: RequestStatus;
  category?: RequestCategory;
  from?: string;
  to?: string;
  page: number;
}
