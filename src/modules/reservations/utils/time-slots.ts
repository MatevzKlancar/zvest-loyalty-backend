/**
 * Time Slot Utility Functions
 */

import type { DayOfWeek } from '../reservation.constants';

/**
 * Parse time string (HH:MM) to minutes from midnight
 */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Convert minutes from midnight to time string (HH:MM)
 */
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Get day of week from date (0 = Sunday, 6 = Saturday)
 */
export function getDayOfWeek(date: Date): DayOfWeek {
  return date.getDay() as DayOfWeek;
}

/**
 * Generate time slots for a given time range
 */
export function generateTimeSlots(
  startTime: string,
  endTime: string,
  slotDurationMinutes: number,
  serviceDurationMinutes: number | null
): { start: string; end: string }[] {
  const slots: { start: string; end: string }[] = [];
  const effectiveDuration = serviceDurationMinutes || slotDurationMinutes;

  let currentMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  while (currentMinutes + effectiveDuration <= endMinutes) {
    const slotStart = minutesToTime(currentMinutes);
    const slotEnd = minutesToTime(currentMinutes + effectiveDuration);

    slots.push({ start: slotStart, end: slotEnd });

    // Move to next slot (use slot duration for stepping, not service duration)
    currentMinutes += slotDurationMinutes;
  }

  return slots;
}

/**
 * Check if two time ranges overlap
 */
export function doTimesOverlap(
  start1: Date,
  end1: Date,
  start2: Date,
  end2: Date
): boolean {
  return start1 < end2 && start2 < end1;
}

/**
 * Combine date with time string to create a Date object
 */
export function combineDateAndTime(date: Date, time: string, timezone = 'Europe/Ljubljana'): Date {
  const dateStr = date.toISOString().split('T')[0];
  const datetimeStr = `${dateStr}T${time}:00`;

  // Create date in the specified timezone
  // Note: For proper timezone handling, consider using a library like date-fns-tz
  return new Date(datetimeStr);
}

/**
 * Format date to YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get dates between two dates (inclusive)
 */
export function getDateRange(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Check if a datetime falls within quiet hours (22:00-05:00 CET)
 * Used for determining if reminders should be sent
 */
export function isQuietHours(date: Date = new Date()): boolean {
  const cetHour = new Date(
    date.toLocaleString('en-US', { timeZone: 'Europe/Ljubljana' })
  ).getHours();

  return cetHour >= 22 || cetHour < 5;
}

/**
 * Add hours to a date
 */
export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Add minutes to a date
 */
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

/**
 * Check if date is in the past
 */
export function isPast(date: Date): boolean {
  return date < new Date();
}

/**
 * Check if date is today
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}
