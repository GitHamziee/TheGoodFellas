export type Role = 'JUNIOR_CLOSER' | 'CLOSER' | 'ADMIN' | 'CLIENT';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone?: string | null;
}
