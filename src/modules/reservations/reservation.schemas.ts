/**
 * Reservation Module Zod Schemas
 */

import { z } from 'zod';
import {
  RESERVATION_STATUS,
  SERVICE_TYPE,
  RESOURCE_TYPE,
  CONFIRMATION_MODE,
  BLOCK_TYPE,
} from './reservation.constants';

// ============================================
// Common Schemas
// ============================================

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const timeSchema = z.string().regex(timeRegex, 'Time must be in HH:MM format');

export const dayOfWeekSchema = z.number().int().min(0).max(6);

// ============================================
// Service Schemas
// ============================================

export const createServiceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  duration_minutes: z.number().int().min(1).max(480).optional(), // Max 8 hours
  price: z.number().min(0).optional(),
  type: z.enum([SERVICE_TYPE.SERVICE, SERVICE_TYPE.TABLE, SERVICE_TYPE.SLOT]),
  capacity: z.number().int().min(1).max(100).default(1),
  requires_resource: z.boolean().default(true),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

export const updateServiceSchema = createServiceSchema.partial();

export const serviceResponseSchema = z.object({
  id: z.string().uuid(),
  shop_id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  duration_minutes: z.number().nullable(),
  price: z.number().nullable(),
  type: z.string(),
  capacity: z.number().nullable(),
  requires_resource: z.boolean().nullable(),
  is_active: z.boolean().nullable(),
  sort_order: z.number().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

// ============================================
// Resource Schemas
// ============================================

export const createResourceSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum([RESOURCE_TYPE.STAFF, RESOURCE_TYPE.TABLE, RESOURCE_TYPE.ROOM, RESOURCE_TYPE.OTHER]),
  image_url: z.string().url().max(500).optional(),
  description: z.string().max(1000).optional(),
  specialties: z.array(z.string().max(100)).max(20).optional(),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

export const updateResourceSchema = createResourceSchema.partial();

export const resourceResponseSchema = z.object({
  id: z.string().uuid(),
  shop_id: z.string().uuid(),
  name: z.string(),
  type: z.string(),
  image_url: z.string().nullable(),
  description: z.string().nullable(),
  specialties: z.any().nullable(), // JSON array
  is_active: z.boolean().nullable(),
  sort_order: z.number().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

// ============================================
// Resource-Service Link Schemas
// ============================================

export const setResourceServicesSchema = z.object({
  services: z.array(z.object({
    service_id: z.string().uuid(),
    price_override: z.number().min(0).nullable().optional(),
    duration_override: z.number().int().min(1).max(480).nullable().optional(),
    is_active: z.boolean().default(true),
  })).min(1),
});

export const resourceServiceResponseSchema = z.object({
  id: z.string().uuid(),
  resource_id: z.string().uuid(),
  service_id: z.string().uuid(),
  price_override: z.number().nullable(),
  duration_override: z.number().nullable(),
  is_active: z.boolean().nullable(),
  created_at: z.string().nullable(),
});

// ============================================
// Availability Schemas
// ============================================

export const setAvailabilitySchema = z.object({
  resource_id: z.string().uuid().nullable().optional(),
  availability: z.array(z.object({
    day_of_week: dayOfWeekSchema,
    start_time: timeSchema,
    end_time: timeSchema,
  })).min(1),
});

export const availabilityResponseSchema = z.object({
  id: z.string().uuid(),
  shop_id: z.string().uuid(),
  resource_id: z.string().uuid().nullable(),
  day_of_week: z.number(),
  start_time: z.string(),
  end_time: z.string(),
  is_active: z.boolean().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

// ============================================
// Block Schemas
// ============================================

export const createBlockSchema = z.object({
  resource_id: z.string().uuid().nullable().optional(),
  start_datetime: z.string().datetime(),
  end_datetime: z.string().datetime(),
  reason: z.string().max(255).optional(),
  block_type: z.enum([BLOCK_TYPE.HOLIDAY, BLOCK_TYPE.VACATION, BLOCK_TYPE.BREAK, BLOCK_TYPE.CUSTOM]).default(BLOCK_TYPE.CUSTOM),
});

export const blockResponseSchema = z.object({
  id: z.string().uuid(),
  shop_id: z.string().uuid(),
  resource_id: z.string().uuid().nullable(),
  start_datetime: z.string(),
  end_datetime: z.string(),
  reason: z.string().nullable(),
  block_type: z.string().nullable(),
  created_at: z.string().nullable(),
});

// ============================================
// Reservation Schemas
// ============================================

export const createReservationSchema = z.object({
  service_id: z.string().uuid(),
  resource_id: z.string().uuid().nullable().optional(),
  start_time: z.string().datetime(),
  party_size: z.number().int().min(1).max(50).default(1),
  customer_notes: z.string().max(500).optional(),
  // Guest fields (required if not authenticated)
  guest_name: z.string().min(1).max(255).optional(),
  guest_phone: z.string().min(5).max(50).optional(),
  guest_email: z.string().email().max(255).optional(),
});

export const updateReservationSchema = z.object({
  resource_id: z.string().uuid().nullable().optional(),
  start_time: z.string().datetime().optional(),
  party_size: z.number().int().min(1).max(50).optional(),
  customer_notes: z.string().max(500).optional(),
  internal_notes: z.string().max(1000).optional(),
  status: z.enum([
    RESERVATION_STATUS.PENDING,
    RESERVATION_STATUS.CONFIRMED,
    RESERVATION_STATUS.CANCELLED,
    RESERVATION_STATUS.COMPLETED,
    RESERVATION_STATUS.NO_SHOW,
  ]).optional(),
});

export const cancelReservationSchema = z.object({
  cancellation_reason: z.string().max(500).optional(),
});

export const reservationResponseSchema = z.object({
  id: z.string().uuid(),
  shop_id: z.string().uuid(),
  service_id: z.string().uuid(),
  resource_id: z.string().uuid().nullable(),
  app_user_id: z.string().uuid().nullable(),
  guest_name: z.string().nullable(),
  guest_phone: z.string().nullable(),
  guest_email: z.string().nullable(),
  start_time: z.string(),
  end_time: z.string().nullable(),
  party_size: z.number().nullable(),
  price: z.number().nullable(),
  status: z.string().nullable(),
  confirmation_mode: z.string().nullable(),
  confirmed_at: z.string().nullable(),
  confirmed_by: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  cancelled_by: z.string().nullable(),
  cancellation_reason: z.string().nullable(),
  no_show_marked_at: z.string().nullable(),
  customer_notes: z.string().nullable(),
  internal_notes: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

export const reservationWithDetailsSchema = reservationResponseSchema.extend({
  service: serviceResponseSchema.optional(),
  resource: resourceResponseSchema.nullable().optional(),
  app_user: z.object({
    id: z.string().uuid(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    email: z.string().nullable(),
    phone_number: z.string().nullable(),
  }).nullable().optional(),
});

// ============================================
// Availability Query Schemas
// ============================================

export const getAvailabilityQuerySchema = z.object({
  service_id: z.string().uuid(),
  resource_id: z.string().uuid().optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});

export const timeSlotSchema = z.object({
  start_time: z.string(),
  end_time: z.string(),
  available: z.boolean(),
  resource_id: z.string().uuid().nullable().optional(),
  resource_name: z.string().nullable().optional(),
});

export const dayAvailabilitySchema = z.object({
  date: z.string(),
  slots: z.array(timeSlotSchema),
});

// ============================================
// Shop Settings Schema
// ============================================

export const reservationSettingsSchema = z.object({
  confirmation_mode: z.enum([CONFIRMATION_MODE.AUTO, CONFIRMATION_MODE.MANUAL]).default(CONFIRMATION_MODE.AUTO),
  cancellation_hours: z.number().int().min(0).max(168).default(24), // Max 1 week
  max_advance_days: z.number().int().min(1).max(365).default(30),
  min_advance_hours: z.number().int().min(0).max(72).default(1),
  allow_any_staff: z.boolean().default(true),
  slot_duration_minutes: z.number().int().min(5).max(120).default(30),
});

export const updateReservationSettingsSchema = reservationSettingsSchema.partial();
