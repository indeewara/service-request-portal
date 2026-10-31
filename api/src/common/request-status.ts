/** Shared by requests (the workflow) and notifications (the emails it triggers). */
export enum RequestStatus {
  NEW = 'NEW',
  IN_REVIEW = 'IN_REVIEW',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED',
}
