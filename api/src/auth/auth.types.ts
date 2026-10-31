export enum Role {
  CUSTOMER = 'CUSTOMER',
  STAFF = 'STAFF',
}

/** The caller, as decoded from the JWT and attached to `req.user`. */
export interface AuthUser {
  id: string;
  role: Role;
}

export interface JwtPayload {
  sub: string;
  role: Role;
}
