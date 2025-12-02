/**
 * Reservation Service
 * Core business logic for managing reservations
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';
import type {
  ReservationRow,
  ReservationInsert,
  ReservationUpdate,
  ReservationWithDetails,
  ReservationSettings,
} from '../reservation.types';
import {
  RESERVATION_STATUS,
  CONFIRMATION_MODE,
  DEFAULT_RESERVATION_SETTINGS,
} from '../reservation.constants';
import { addHours, isPast } from '../utils/time-slots';

type SupabaseDb = SupabaseClient<Database>;

export class ReservationService {
  constructor(private db: SupabaseDb) {}

  /**
   * Get shop reservation settings
   */
  async getShopSettings(shopId: string): Promise<ReservationSettings> {
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

  /**
   * Check if shop has reservations enabled
   */
  async isReservationsEnabled(shopId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('shops')
      .select('reservations_enabled')
      .eq('id', shopId)
      .single();

    if (error) throw error;
    return data?.reservations_enabled ?? false;
  }

  /**
   * Create a new reservation
   */
  async createReservation(
    shopId: string,
    data: {
      service_id: string;
      resource_id?: string | null;
      start_time: string;
      party_size?: number;
      customer_notes?: string;
      app_user_id?: string | null;
      guest_name?: string;
      guest_phone?: string;
      guest_email?: string;
    }
  ): Promise<ReservationRow> {
    const settings = await this.getShopSettings(shopId);

    // Get service to calculate end time
    const { data: service, error: serviceError } = await this.db
      .from('reservation_services')
      .select('*')
      .eq('id', data.service_id)
      .eq('shop_id', shopId)
      .single();

    if (serviceError || !service) {
      throw new Error('Service not found');
    }

    // Check if resource can provide this service (if resource specified)
    if (data.resource_id) {
      const { data: resourceService, error: rsError } = await this.db
        .from('reservation_resource_services')
        .select('*, reservation_resources!inner(*)')
        .eq('resource_id', data.resource_id)
        .eq('service_id', data.service_id)
        .eq('is_active', true)
        .single();

      if (rsError || !resourceService) {
        throw new Error('Resource cannot provide this service');
      }
    }

    // Calculate end time
    const startTime = new Date(data.start_time);
    const durationMinutes = service.duration_minutes || settings.slot_duration_minutes;
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    // Validate booking window
    const now = new Date();
    const minAdvance = addHours(now, settings.min_advance_hours);
    const maxAdvance = addHours(now, settings.max_advance_days * 24);

    if (startTime < minAdvance) {
      throw new Error(`Reservations must be made at least ${settings.min_advance_hours} hours in advance`);
    }

    if (startTime > maxAdvance) {
      throw new Error(`Reservations can only be made up to ${settings.max_advance_days} days in advance`);
    }

    // Check for conflicts
    const hasConflict = await this.checkConflict(
      shopId,
      data.resource_id || null,
      startTime,
      endTime
    );

    if (hasConflict) {
      throw new Error('This time slot is no longer available');
    }

    // Determine confirmation status
    const status = settings.confirmation_mode === CONFIRMATION_MODE.AUTO
      ? RESERVATION_STATUS.CONFIRMED
      : RESERVATION_STATUS.PENDING;

    const insertData: ReservationInsert = {
      shop_id: shopId,
      service_id: data.service_id,
      resource_id: data.resource_id || null,
      app_user_id: data.app_user_id || null,
      guest_name: data.guest_name || null,
      guest_phone: data.guest_phone || null,
      guest_email: data.guest_email || null,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      party_size: data.party_size || 1,
      price: service.price,
      status,
      confirmation_mode: settings.confirmation_mode,
      confirmed_at: status === RESERVATION_STATUS.CONFIRMED ? new Date().toISOString() : null,
      customer_notes: data.customer_notes || null,
    };

    const { data: reservation, error } = await this.db
      .from('reservations')
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;
    return reservation;
  }

  /**
   * Check for scheduling conflicts
   */
  async checkConflict(
    shopId: string,
    resourceId: string | null,
    startTime: Date,
    endTime: Date
  ): Promise<boolean> {
    let query = this.db
      .from('reservations')
      .select('id')
      .eq('shop_id', shopId)
      .in('status', [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CONFIRMED])
      .lt('start_time', endTime.toISOString())
      .gt('end_time', startTime.toISOString());

    if (resourceId) {
      query = query.eq('resource_id', resourceId);
    }

    const { data, error } = await query.limit(1);

    if (error) throw error;
    return (data?.length || 0) > 0;
  }

  /**
   * Get reservation by ID with details
   */
  async getReservation(
    reservationId: string,
    shopId?: string
  ): Promise<ReservationWithDetails | null> {
    let query = this.db
      .from('reservations')
      .select(`
        *,
        service:reservation_services(*),
        resource:reservation_resources(*),
        app_user:app_users(id, first_name, last_name, email, phone_number)
      `)
      .eq('id', reservationId);

    if (shopId) {
      query = query.eq('shop_id', shopId);
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return data as ReservationWithDetails;
  }

  /**
   * List reservations for a shop
   */
  async listReservations(
    shopId: string,
    options: {
      status?: string[];
      resource_id?: string;
      date_from?: string;
      date_to?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ data: ReservationWithDetails[]; count: number }> {
    let query = this.db
      .from('reservations')
      .select(`
        *,
        service:reservation_services(*),
        resource:reservation_resources(*),
        app_user:app_users(id, first_name, last_name, email, phone_number)
      `, { count: 'exact' })
      .eq('shop_id', shopId)
      .order('start_time', { ascending: true });

    if (options.status?.length) {
      query = query.in('status', options.status);
    }

    if (options.resource_id) {
      query = query.eq('resource_id', options.resource_id);
    }

    if (options.date_from) {
      query = query.gte('start_time', options.date_from);
    }

    if (options.date_to) {
      query = query.lte('start_time', options.date_to);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 20) - 1);
    }

    const { data, error, count } = await query;

    if (error) throw error;
    return { data: (data || []) as ReservationWithDetails[], count: count || 0 };
  }

  /**
   * List reservations for an app user
   */
  async listUserReservations(
    appUserId: string,
    options: {
      status?: string[];
      upcoming_only?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ data: ReservationWithDetails[]; count: number }> {
    let query = this.db
      .from('reservations')
      .select(`
        *,
        service:reservation_services(*),
        resource:reservation_resources(*),
        shop:shops(id, name, logo_url, address)
      `, { count: 'exact' })
      .eq('app_user_id', appUserId)
      .order('start_time', { ascending: true });

    if (options.status?.length) {
      query = query.in('status', options.status);
    }

    if (options.upcoming_only) {
      query = query
        .gte('start_time', new Date().toISOString())
        .in('status', [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CONFIRMED]);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 20) - 1);
    }

    const { data, error, count } = await query;

    if (error) throw error;
    return { data: (data || []) as ReservationWithDetails[], count: count || 0 };
  }

  /**
   * Update a reservation (shop admin)
   */
  async updateReservation(
    reservationId: string,
    shopId: string,
    updates: ReservationUpdate
  ): Promise<ReservationRow> {
    // If changing time, validate and recalculate end_time
    if (updates.start_time) {
      const reservation = await this.getReservation(reservationId, shopId);
      if (!reservation) throw new Error('Reservation not found');

      const { data: service } = await this.db
        .from('reservation_services')
        .select('duration_minutes')
        .eq('id', reservation.service_id)
        .single();

      const settings = await this.getShopSettings(shopId);
      const durationMinutes = service?.duration_minutes || settings.slot_duration_minutes;
      const startTime = new Date(updates.start_time);
      const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

      updates.end_time = endTime.toISOString();

      // Check for conflicts (excluding current reservation)
      const hasConflict = await this.checkConflictExcluding(
        shopId,
        reservation.resource_id,
        startTime,
        endTime,
        reservationId
      );

      if (hasConflict) {
        throw new Error('This time slot is no longer available');
      }
    }

    const { data, error } = await this.db
      .from('reservations')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reservationId)
      .eq('shop_id', shopId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Check conflict excluding a specific reservation
   */
  private async checkConflictExcluding(
    shopId: string,
    resourceId: string | null,
    startTime: Date,
    endTime: Date,
    excludeReservationId: string
  ): Promise<boolean> {
    let query = this.db
      .from('reservations')
      .select('id')
      .eq('shop_id', shopId)
      .neq('id', excludeReservationId)
      .in('status', [RESERVATION_STATUS.PENDING, RESERVATION_STATUS.CONFIRMED])
      .lt('start_time', endTime.toISOString())
      .gt('end_time', startTime.toISOString());

    if (resourceId) {
      query = query.eq('resource_id', resourceId);
    }

    const { data, error } = await query.limit(1);

    if (error) throw error;
    return (data?.length || 0) > 0;
  }

  /**
   * Confirm a reservation (shop admin)
   */
  async confirmReservation(
    reservationId: string,
    shopId: string,
    confirmedBy: string
  ): Promise<ReservationRow> {
    const { data, error } = await this.db
      .from('reservations')
      .update({
        status: RESERVATION_STATUS.CONFIRMED,
        confirmed_at: new Date().toISOString(),
        confirmed_by: confirmedBy,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reservationId)
      .eq('shop_id', shopId)
      .eq('status', RESERVATION_STATUS.PENDING)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Cancel a reservation
   */
  async cancelReservation(
    reservationId: string,
    cancelledBy: string,
    reason?: string,
    isShopAdmin: boolean = false,
    shopId?: string
  ): Promise<ReservationRow> {
    // Get the reservation
    const reservation = await this.getReservation(reservationId, shopId);
    if (!reservation) throw new Error('Reservation not found');

    // Check if already cancelled
    if (reservation.status === RESERVATION_STATUS.CANCELLED) {
      throw new Error('Reservation is already cancelled');
    }

    // Check if completed
    if (reservation.status === RESERVATION_STATUS.COMPLETED) {
      throw new Error('Cannot cancel a completed reservation');
    }

    // If not shop admin, check cancellation deadline
    if (!isShopAdmin) {
      const settings = await this.getShopSettings(reservation.shop_id);
      const startTime = new Date(reservation.start_time);
      const deadline = addHours(new Date(), settings.cancellation_hours);

      if (startTime < deadline) {
        throw new Error(`Cancellations must be made at least ${settings.cancellation_hours} hours before the reservation`);
      }
    }

    const { data, error } = await this.db
      .from('reservations')
      .update({
        status: RESERVATION_STATUS.CANCELLED,
        cancelled_at: new Date().toISOString(),
        cancelled_by: cancelledBy,
        cancellation_reason: reason || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reservationId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Mark reservation as completed
   */
  async completeReservation(
    reservationId: string,
    shopId: string
  ): Promise<ReservationRow> {
    const { data, error } = await this.db
      .from('reservations')
      .update({
        status: RESERVATION_STATUS.COMPLETED,
        updated_at: new Date().toISOString(),
      })
      .eq('id', reservationId)
      .eq('shop_id', shopId)
      .in('status', [RESERVATION_STATUS.CONFIRMED])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Mark reservation as no-show
   */
  async markNoShow(
    reservationId: string,
    shopId: string
  ): Promise<ReservationRow> {
    const reservation = await this.getReservation(reservationId, shopId);
    if (!reservation) throw new Error('Reservation not found');

    // Update reservation
    const { data, error } = await this.db
      .from('reservations')
      .update({
        status: RESERVATION_STATUS.NO_SHOW,
        no_show_marked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', reservationId)
      .eq('shop_id', shopId)
      .select()
      .single();

    if (error) throw error;

    // Increment user's no-show count if app user
    if (reservation.app_user_id) {
      await this.db.rpc('increment_no_show_count', {
        user_id: reservation.app_user_id,
      });
    }

    return data;
  }

  /**
   * Get reservation counts by status for a shop
   */
  async getReservationStats(
    shopId: string,
    dateFrom?: string,
    dateTo?: string
  ): Promise<Record<string, number>> {
    let query = this.db
      .from('reservations')
      .select('status')
      .eq('shop_id', shopId);

    if (dateFrom) {
      query = query.gte('start_time', dateFrom);
    }

    if (dateTo) {
      query = query.lte('start_time', dateTo);
    }

    const { data, error } = await query;

    if (error) throw error;

    const stats: Record<string, number> = {
      pending: 0,
      confirmed: 0,
      cancelled: 0,
      completed: 0,
      no_show: 0,
      total: 0,
    };

    for (const reservation of data || []) {
      if (reservation.status) {
        stats[reservation.status] = (stats[reservation.status] || 0) + 1;
      }
      stats.total++;
    }

    return stats;
  }
}
