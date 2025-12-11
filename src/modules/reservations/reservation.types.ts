/**
 * Reservation Module Types
 */

import type { Database } from '../../types/database';
import type {
  ReservationStatus,
  ServiceType,
  ResourceType,
  ConfirmationMode,
  BlockType,
  DayOfWeek,
} from './reservation.constants';

// Database row types
export type ReservationServiceRow = Database['public']['Tables']['reservation_services']['Row'];
export type ReservationServiceInsert = Database['public']['Tables']['reservation_services']['Insert'];
export type ReservationServiceUpdate = Database['public']['Tables']['reservation_services']['Update'];

export type ReservationResourceRow = Database['public']['Tables']['reservation_resources']['Row'];
export type ReservationResourceInsert = Database['public']['Tables']['reservation_resources']['Insert'];
export type ReservationResourceUpdate = Database['public']['Tables']['reservation_resources']['Update'];

export type ReservationRow = Database['public']['Tables']['reservations']['Row'];
export type ReservationInsert = Database['public']['Tables']['reservations']['Insert'];
export type ReservationUpdate = Database['public']['Tables']['reservations']['Update'];

export type ReservationAvailabilityRow = Database['public']['Tables']['reservation_availability']['Row'];
export type ReservationBlockRow = Database['public']['Tables']['reservation_blocks']['Row'];
export type ReservationResourceServiceRow = Database['public']['Tables']['reservation_resource_services']['Row'];

// Extended types with relations
export interface ServiceWithResources extends ReservationServiceRow {
  resources?: ResourceWithPricing[];
}

export interface ResourceWithPricing extends ReservationResourceRow {
  price_override?: number | null;
  duration_override?: number | null;
}

export interface ResourceWithServices extends ReservationResourceRow {
  services?: ReservationResourceServiceRow[];
  availability?: ReservationAvailabilityRow[];
}

export interface ReservationWithDetails extends ReservationRow {
  service?: ReservationServiceRow;
  resource?: ReservationResourceRow | null;
  app_user?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone_number: string | null;
  } | null;
}

// Availability types
export interface TimeSlot {
  start_time: string; // ISO datetime
  end_time: string; // ISO datetime
  available: boolean;
  resource_id?: string | null;
  resource_name?: string | null;
}

export interface DayAvailability {
  date: string; // YYYY-MM-DD
  slots: TimeSlot[];
}

export interface AvailabilityQuery {
  shop_id: string;
  service_id: string;
  resource_id?: string | null; // null = any available
  date_from: string; // YYYY-MM-DD
  date_to: string; // YYYY-MM-DD
}

// Reservation settings (stored in shops.reservation_settings)
export interface ReservationSettings {
  confirmation_mode: ConfirmationMode;
  cancellation_hours: number;
  max_advance_days: number;
  min_advance_hours: number;
  allow_any_staff: boolean;
  slot_duration_minutes: number;
}

// Request/Response types
export interface CreateReservationRequest {
  service_id: string;
  resource_id?: string | null;
  start_time: string;
  party_size?: number;
  customer_notes?: string;
  // For app users - taken from auth
  // For guests:
  guest_name?: string;
  guest_phone?: string;
  guest_email?: string;
}

export interface UpdateReservationRequest {
  resource_id?: string | null;
  start_time?: string;
  party_size?: number;
  customer_notes?: string;
  internal_notes?: string;
  status?: ReservationStatus;
}

export interface CancelReservationRequest {
  cancellation_reason?: string;
}

// Shop admin types
export interface CreateServiceRequest {
  name: string;
  description?: string;
  duration_minutes?: number;
  price?: number;
  type: ServiceType;
  capacity?: number;
  requires_resource?: boolean;
  is_active?: boolean;
  sort_order?: number;
}

export interface CreateResourceRequest {
  name: string;
  type: ResourceType;
  image_url?: string;
  description?: string;
  specialties?: string[];
  is_active?: boolean;
  sort_order?: number;
}

export interface SetResourceServicesRequest {
  services: {
    service_id: string;
    price_override?: number | null;
    duration_override?: number | null;
    is_active?: boolean;
  }[];
}

export interface SetAvailabilityRequest {
  resource_id?: string | null; // null = shop-level
  availability: {
    day_of_week: DayOfWeek;
    start_time: string; // HH:MM
    end_time: string; // HH:MM
  }[];
}

export interface CreateBlockRequest {
  resource_id?: string | null;
  start_datetime: string;
  end_datetime: string;
  reason?: string;
  block_type?: BlockType;
}
