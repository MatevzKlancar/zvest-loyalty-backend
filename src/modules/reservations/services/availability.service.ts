/**
 * Availability Service
 * Handles slot availability calculations and schedule management
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';
import type {
  ReservationAvailabilityRow,
  ReservationBlockRow,
  TimeSlot,
  DayAvailability,
  ReservationSettings,
} from '../reservation.types';
import {
  RESERVATION_STATUS,
  DEFAULT_RESERVATION_SETTINGS,
} from '../reservation.constants';
import {
  getDayOfWeek,
  generateTimeSlots,
  formatDate,
  getDateRange,
  combineDateAndTime,
  addHours,
} from '../utils/time-slots';

type SupabaseDb = SupabaseClient<Database>;

export class AvailabilityService {
  constructor(private db: SupabaseDb) {}

  /**
   * Get available time slots for a service
   */
  async getAvailability(
    shopId: string,
    serviceId: string,
    dateFrom: string,
    dateTo: string,
    resourceId?: string | null
  ): Promise<DayAvailability[]> {
    // Get shop settings
    const settings = await this.getShopSettings(shopId);

    // Get service details
    const { data: service, error: serviceError } = await this.db
      .from('reservation_services')
      .select('*')
      .eq('id', serviceId)
      .eq('shop_id', shopId)
      .eq('is_active', true)
      .single();

    if (serviceError || !service) {
      throw new Error('Service not found or inactive');
    }

    // Get resources that can provide this service
    let resourceQuery = this.db
      .from('reservation_resource_services')
      .select(`
        *,
        resource:reservation_resources!inner(*)
      `)
      .eq('service_id', serviceId)
      .eq('is_active', true);

    if (resourceId) {
      resourceQuery = resourceQuery.eq('resource_id', resourceId);
    }

    const { data: resourceServices } = await resourceQuery;

    // Get shop-level availability if no specific resource or service doesn't require resource
    const resourceIds = resourceServices?.map(rs => rs.resource_id) || [];

    // Get availability schedules
    const { data: availabilities } = await this.db
      .from('reservation_availability')
      .select('*')
      .eq('shop_id', shopId)
      .eq('is_active', true)
      .or(
        resourceIds.length > 0
          ? `resource_id.is.null,resource_id.in.(${resourceIds.join(',')})`
          : 'resource_id.is.null'
      );

    // Get blocks
    const { data: blocks } = await this.db
      .from('reservation_blocks')
      .select('*')
      .eq('shop_id', shopId)
      .gte('end_datetime', dateFrom)
      .lte('start_datetime', dateTo + 'T23:59:59');

    // Get existing reservations
    const { data: reservations } = await this.db
      .from('reservations')
      .select('*')
      .eq('shop_id', shopId)
      .in('status', [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CONFIRMED])
      .gte('start_time', dateFrom)
      .lte('start_time', dateTo + 'T23:59:59');

    // Calculate available slots for each day
    const startDate = new Date(dateFrom);
    const endDate = new Date(dateTo);
    const dates = getDateRange(startDate, endDate);
    const now = new Date();
    const minAdvanceTime = addHours(now, settings.min_advance_hours);

    const result: DayAvailability[] = [];

    for (const date of dates) {
      const dayOfWeek = getDayOfWeek(date);
      const dateStr = formatDate(date);

      // Get availability for this day
      const dayAvailabilities = (availabilities || []).filter(
        a => a.day_of_week === dayOfWeek
      );

      // Get blocks for this day
      const dayBlocks = (blocks || []).filter(b => {
        const blockStart = new Date(b.start_datetime);
        const blockEnd = new Date(b.end_datetime);
        const dayStart = new Date(dateStr);
        const dayEnd = new Date(dateStr + 'T23:59:59');
        return blockStart < dayEnd && blockEnd > dayStart;
      });

      // Get reservations for this day
      const dayReservations = (reservations || []).filter(r => {
        const resDate = formatDate(new Date(r.start_time));
        return resDate === dateStr;
      });

      // Generate slots based on resource availability
      const slots: TimeSlot[] = [];

      if (service.requires_resource && resourceServices && resourceServices.length > 0) {
        // Generate slots per resource
        for (const rs of resourceServices) {
          const resource = (rs as any).resource;
          const resourceAvail = dayAvailabilities.filter(
            a => a.resource_id === rs.resource_id || a.resource_id === null
          );

          // Use most specific availability (resource-level over shop-level)
          const effectiveAvail = resourceAvail.filter(a => a.resource_id === rs.resource_id).length > 0
            ? resourceAvail.filter(a => a.resource_id === rs.resource_id)
            : resourceAvail.filter(a => a.resource_id === null);

          for (const avail of effectiveAvail) {
            const duration = rs.duration_override || service.duration_minutes || settings.slot_duration_minutes;
            const timeSlots = generateTimeSlots(
              avail.start_time,
              avail.end_time,
              settings.slot_duration_minutes,
              duration
            );

            for (const ts of timeSlots) {
              const slotStart = combineDateAndTime(date, ts.start);
              const slotEnd = combineDateAndTime(date, ts.end);

              // Check if slot is in the past or too soon
              if (slotStart < minAdvanceTime) continue;

              // Check if blocked
              const isBlocked = dayBlocks.some(b => {
                const blockStart = new Date(b.start_datetime);
                const blockEnd = new Date(b.end_datetime);
                return (
                  (b.resource_id === null || b.resource_id === rs.resource_id) &&
                  slotStart < blockEnd &&
                  slotEnd > blockStart
                );
              });

              if (isBlocked) continue;

              // Check if already booked for this resource
              const isBooked = dayReservations.some(r => {
                if (r.resource_id !== rs.resource_id) return false;
                const resStart = new Date(r.start_time);
                const resEnd = new Date(r.end_time!);
                return slotStart < resEnd && slotEnd > resStart;
              });

              slots.push({
                start_time: slotStart.toISOString(),
                end_time: slotEnd.toISOString(),
                available: !isBooked,
                resource_id: rs.resource_id,
                resource_name: resource?.name || null,
              });
            }
          }
        }
      } else {
        // Shop-level slots (no specific resource required)
        const shopAvail = dayAvailabilities.filter(a => a.resource_id === null);

        for (const avail of shopAvail) {
          const duration = service.duration_minutes || settings.slot_duration_minutes;
          const timeSlots = generateTimeSlots(
            avail.start_time,
            avail.end_time,
            settings.slot_duration_minutes,
            duration
          );

          for (const ts of timeSlots) {
            const slotStart = combineDateAndTime(date, ts.start);
            const slotEnd = combineDateAndTime(date, ts.end);

            // Check if slot is in the past or too soon
            if (slotStart < minAdvanceTime) continue;

            // Check if blocked (shop-level blocks)
            const isBlocked = dayBlocks.some(b => {
              if (b.resource_id !== null) return false;
              const blockStart = new Date(b.start_datetime);
              const blockEnd = new Date(b.end_datetime);
              return slotStart < blockEnd && slotEnd > blockStart;
            });

            if (isBlocked) continue;

            // Check capacity
            const overlappingReservations = dayReservations.filter(r => {
              const resStart = new Date(r.start_time);
              const resEnd = new Date(r.end_time!);
              return slotStart < resEnd && slotEnd > resStart;
            });

            const totalPartySize = overlappingReservations.reduce(
              (sum, r) => sum + (r.party_size || 1),
              0
            );

            const available = totalPartySize < (service.capacity || 1);

            slots.push({
              start_time: slotStart.toISOString(),
              end_time: slotEnd.toISOString(),
              available,
              resource_id: null,
              resource_name: null,
            });
          }
        }
      }

      // Sort slots by time
      slots.sort((a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
      );

      result.push({
        date: dateStr,
        slots,
      });
    }

    return result;
  }

  /**
   * Get first available slot for a service
   */
  async getNextAvailableSlot(
    shopId: string,
    serviceId: string,
    resourceId?: string | null
  ): Promise<TimeSlot | null> {
    const settings = await this.getShopSettings(shopId);
    const now = new Date();
    const maxDate = addHours(now, settings.max_advance_days * 24);

    // Search day by day for up to max_advance_days
    let currentDate = new Date(now);

    while (currentDate < maxDate) {
      const dateStr = formatDate(currentDate);
      const availability = await this.getAvailability(
        shopId,
        serviceId,
        dateStr,
        dateStr,
        resourceId
      );

      if (availability.length > 0 && availability[0].slots.length > 0) {
        const availableSlot = availability[0].slots.find(s => s.available);
        if (availableSlot) return availableSlot;
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return null;
  }

  /**
   * Get shop settings
   */
  private async getShopSettings(shopId: string): Promise<ReservationSettings> {
    const { data, error } = await this.db
      .from('shops')
      .select('reservation_settings')
      .eq('id', shopId)
      .single();

    if (error) throw error;

    return {
      ...DEFAULT_RESERVATION_SETTINGS,
      ...(data?.reservation_settings as Partial<ReservationSettings> || {}),
    };
  }

  // ============================================
  // Availability Schedule Management
  // ============================================

  /**
   * Set availability schedule for shop or resource
   */
  async setAvailability(
    shopId: string,
    resourceId: string | null,
    availability: { day_of_week: number; start_time: string; end_time: string }[]
  ): Promise<ReservationAvailabilityRow[]> {
    // Delete existing availability
    let deleteQuery = this.db
      .from('reservation_availability')
      .delete()
      .eq('shop_id', shopId);

    if (resourceId === null) {
      deleteQuery = deleteQuery.is('resource_id', null);
    } else {
      deleteQuery = deleteQuery.eq('resource_id', resourceId);
    }

    await deleteQuery;

    // Insert new availability
    const insertData = availability.map(a => ({
      shop_id: shopId,
      resource_id: resourceId,
      day_of_week: a.day_of_week,
      start_time: a.start_time,
      end_time: a.end_time,
      is_active: true,
    }));

    const { data, error } = await this.db
      .from('reservation_availability')
      .insert(insertData)
      .select();

    if (error) throw error;
    return data;
  }

  /**
   * Get availability schedule
   */
  async getAvailabilitySchedule(
    shopId: string,
    resourceId?: string | null
  ): Promise<ReservationAvailabilityRow[]> {
    let query = this.db
      .from('reservation_availability')
      .select('*')
      .eq('shop_id', shopId)
      .eq('is_active', true)
      .order('day_of_week')
      .order('start_time');

    if (resourceId !== undefined) {
      if (resourceId === null) {
        query = query.is('resource_id', null);
      } else {
        query = query.eq('resource_id', resourceId);
      }
    }

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  }

  // ============================================
  // Block Management
  // ============================================

  /**
   * Create a block (holiday, vacation, etc.)
   */
  async createBlock(
    shopId: string,
    data: {
      resource_id?: string | null;
      start_datetime: string;
      end_datetime: string;
      reason?: string;
      block_type?: string;
    }
  ): Promise<ReservationBlockRow> {
    const { data: block, error } = await this.db
      .from('reservation_blocks')
      .insert({
        shop_id: shopId,
        resource_id: data.resource_id || null,
        start_datetime: data.start_datetime,
        end_datetime: data.end_datetime,
        reason: data.reason || null,
        block_type: data.block_type || 'custom',
      })
      .select()
      .single();

    if (error) throw error;
    return block;
  }

  /**
   * List blocks
   */
  async listBlocks(
    shopId: string,
    options: {
      resource_id?: string | null;
      from_date?: string;
      to_date?: string;
    } = {}
  ): Promise<ReservationBlockRow[]> {
    let query = this.db
      .from('reservation_blocks')
      .select('*')
      .eq('shop_id', shopId)
      .order('start_datetime', { ascending: true });

    if (options.resource_id !== undefined) {
      if (options.resource_id === null) {
        query = query.is('resource_id', null);
      } else {
        query = query.eq('resource_id', options.resource_id);
      }
    }

    if (options.from_date) {
      query = query.gte('end_datetime', options.from_date);
    }

    if (options.to_date) {
      query = query.lte('start_datetime', options.to_date);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  }

  /**
   * Delete a block
   */
  async deleteBlock(blockId: string, shopId: string): Promise<void> {
    const { error } = await this.db
      .from('reservation_blocks')
      .delete()
      .eq('id', blockId)
      .eq('shop_id', shopId);

    if (error) throw error;
  }
}
