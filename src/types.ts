export type PairingMode = 'code' | 'qr';
export type WarmupMode = 'one_to_one' | 'one_to_all';
export type AccountStatus = 'pending' | 'connected' | 'disconnected';
export type UserRole = 'user' | 'admin' | 'owner';

export interface UserRow {
  id: number;
  telegram_id: number;
  first_name: string | null;
  username: string | null;
  is_admin: boolean;
  role: UserRole;
  referral_code: string | null;
  referred_by: number | null;
  balance: number;
  last_activity_at: string;
  created_at: string;
}

export interface AccountRow {
  id: number;
  user_id: number;
  phone: string;
  session_key: string | null;
  pairing_mode: PairingMode | null;
  status: AccountStatus;
  session_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface WhatsappSessionRow {
  id: number;
  user_id: number;
  account_id: number | null;
  phone: string;
  session_key: string;
  pairing_mode: PairingMode;
  status: 'pending' | 'connected' | 'expired' | 'closed';
  pairing_code: string | null;
  qr_data: string | null;
  expires_at: string | null;
  session_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface WarmupJob {
  id: string;
  userId: number;
  mode: WarmupMode;
  durationHours: number;
  delayMin: number;
  delayMax: number;
  accountIds: number[];
  startedAt: string;
  endsAt: string;
  status: 'running' | 'completed' | 'stopped';
}
