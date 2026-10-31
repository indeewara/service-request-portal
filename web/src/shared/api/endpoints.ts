import 'server-only';
import { callApiAsUser } from './client';
import type {
  ImageContentType,
  Photo,
  RequestCategory,
  RequestDetails,
  RequestPage,
  RequestStatus,
  ServiceRequest,
  StaffFilters,
  UploadTarget,
} from './types';

/** Typed wrappers for every API call the web app makes, as the signed-in user. */
export const requestsApi = {
  mine: (page: number) => callApiAsUser<RequestPage>(`/requests/mine?page=${page}&pageSize=20`),

  list: (filters: StaffFilters) => {
    const query = new URLSearchParams({ page: String(filters.page), pageSize: '20' });
    for (const key of ['status', 'category', 'from', 'to'] as const) {
      const value = filters[key];
      if (value) query.set(key, value);
    }
    return callApiAsUser<RequestPage>(`/requests?${query}`);
  },

  get: (id: string) => callApiAsUser<RequestDetails>(`/requests/${id}`),

  photos: (id: string) => callApiAsUser<Photo[]>(`/requests/${id}/attachments`),

  create: (body: { category: RequestCategory; orderNumber: string; description: string }) =>
    callApiAsUser<ServiceRequest>('/requests', { method: 'POST', body }),

  changeStatus: (id: string, status: RequestStatus) =>
    callApiAsUser<ServiceRequest>(`/requests/${id}/status`, { method: 'PATCH', body: { status } }),

  uploadUrl: (id: string, body: { contentType: ImageContentType; size: number }) =>
    callApiAsUser<UploadTarget>(`/requests/${id}/attachments/upload-url`, { method: 'POST', body }),

  completeUpload: (id: string, attachmentId: string) =>
    callApiAsUser<Photo>(`/requests/${id}/attachments/${attachmentId}/complete`, { method: 'POST' }),
};
