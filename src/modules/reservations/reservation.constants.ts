/**
 * Reservation Module Constants
 */

export const RESERVATION_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  NO_SHOW: 'no_show',
} as const;

export type ReservationStatus = typeof RESERVATION_STATUS[keyof typeof RESERVATION_STATUS];

export const SERVICE_TYPE = {
  SERVICE: 'service',
  TABLE: 'table',
  SLOT: 'slot',
} as const;

export type ServiceType = typeof SERVICE_TYPE[keyof typeof SERVICE_TYPE];

export const RESOURCE_TYPE = {
  STAFF: 'staff',
  TABLE: 'table',
  ROOM: 'room',
  OTHER: 'other',
} as const;

export type ResourceType = typeof RESOURCE_TYPE[keyof typeof RESOURCE_TYPE];

export const CONFIRMATION_MODE = {
  AUTO: 'auto',
  MANUAL: 'manual',
} as const;

export type ConfirmationMode = typeof CONFIRMATION_MODE[keyof typeof CONFIRMATION_MODE];

export const BLOCK_TYPE = {
  HOLIDAY: 'holiday',
  VACATION: 'vacation',
  BREAK: 'break',
  CUSTOM: 'custom',
} as const;

export type BlockType = typeof BLOCK_TYPE[keyof typeof BLOCK_TYPE];

export const REMINDER_TYPE = {
  PUSH: 'push',
  EMAIL: 'email',
  SMS: 'sms',
} as const;

export type ReminderType = typeof REMINDER_TYPE[keyof typeof REMINDER_TYPE];

export const REMINDER_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type ReminderStatus = typeof REMINDER_STATUS[keyof typeof REMINDER_STATUS];

// Day of week (0 = Sunday, 6 = Saturday)
export const DAY_OF_WEEK = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
} as const;

export type DayOfWeek = typeof DAY_OF_WEEK[keyof typeof DAY_OF_WEEK];

// Default settings
export const DEFAULT_RESERVATION_SETTINGS = {
  confirmation_mode: CONFIRMATION_MODE.AUTO,
  cancellation_hours: 24, // Hours before reservation when cancellation is allowed
  max_advance_days: 30, // How far in advance can book
  min_advance_hours: 1, // Minimum hours before reservation time
  allow_any_staff: true, // Allow "any available" option
  slot_duration_minutes: 30, // Default slot duration for availability grid
};
