/**
 * Resource Service
 * Manages resources (staff, tables, rooms) and services
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database';
import type {
  ReservationServiceRow,
  ReservationServiceInsert,
  ReservationServiceUpdate,
  ReservationResourceRow,
  ReservationResourceInsert,
  ReservationResourceUpdate,
  ReservationResourceServiceRow,
  ServiceWithResources,
  ResourceWithServices,
} from '../reservation.types';

type SupabaseDb = SupabaseClient<Database>;

export class ResourceService {
  constructor(private db: SupabaseDb) {}

  // ============================================
  // Services
  // ============================================

  /**
   * Create a service
   */
  async createService(
    shopId: string,
    data: Omit<ReservationServiceInsert, 'shop_id'>
  ): Promise<ReservationServiceRow> {
    const { data: service, error } = await this.db
      .from('reservation_services')
      .insert({
        ...data,
        shop_id: shopId,
      })
      .select()
      .single();

    if (error) throw error;
    return service;
  }

  /**
   * Update a service
   */
  async updateService(
    serviceId: string,
    shopId: string,
    updates: ReservationServiceUpdate
  ): Promise<ReservationServiceRow> {
    const { data: service, error } = await this.db
      .from('reservation_services')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', serviceId)
      .eq('shop_id', shopId)
      .select()
      .single();

    if (error) throw error;
    return service;
  }

  /**
   * Get a service by ID
   */
  async getService(
    serviceId: string,
    shopId?: string
  ): Promise<ServiceWithResources | null> {
    let query = this.db
      .from('reservation_services')
      .select(`
        *,
        resource_services:reservation_resource_services(
          *,
          resource:reservation_resources(*)
        )
      `)
      .eq('id', serviceId);

    if (shopId) {
      query = query.eq('shop_id', shopId);
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    // Transform to include resources with pricing
    const service = data as any;
    if (service.resource_services) {
      service.resources = service.resource_services.map((rs: any) => ({
        ...rs.resource,
        price_override: rs.price_override,
        duration_override: rs.duration_override,
      }));
      delete service.resource_services;
    }

    return service as ServiceWithResources;
  }

  /**
   * List services for a shop
   */
  async listServices(
    shopId: string,
    options: { active_only?: boolean } = {}
  ): Promise<ReservationServiceRow[]> {
    let query = this.db
      .from('reservation_services')
      .select('*')
      .eq('shop_id', shopId)
      .order('sort_order')
      .order('name');

    if (options.active_only) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data || [];
  }

  /**
   * Delete a service
   */
  async deleteService(serviceId: string, shopId: string): Promise<void> {
    // Check for existing reservations
    const { data: reservations } = await this.db
      .from('reservations')
      .select('id')
      .eq('service_id', serviceId)
      .limit(1);

    if (reservations && reservations.length > 0) {
      // Soft delete by deactivating
      await this.db
        .from('reservation_services')
        .update({ is_active: false })
        .eq('id', serviceId)
        .eq('shop_id', shopId);
    } else {
      // Hard delete if no reservations
      const { error } = await this.db
        .from('reservation_services')
        .delete()
        .eq('id', serviceId)
        .eq('shop_id', shopId);

      if (error) throw error;
    }
  }

  // ============================================
  // Resources
  // ============================================

  /**
   * Create a resource
   */
  async createResource(
    shopId: string,
    data: Omit<ReservationResourceInsert, 'shop_id'>
  ): Promise<ReservationResourceRow> {
    const { data: resource, error } = await this.db
      .from('reservation_resources')
      .insert({
        ...data,
        shop_id: shopId,
      })
      .select()
      .single();

    if (error) throw error;
    return resource;
  }

  /**
   * Update a resource
   */
  async updateResource(
    resourceId: string,
    shopId: string,
    updates: ReservationResourceUpdate
  ): Promise<ReservationResourceRow> {
    const { data: resource, error } = await this.db
      .from('reservation_resources')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', resourceId)
      .eq('shop_id', shopId)
      .select()
      .single();

    if (error) throw error;
    return resource;
  }

  /**
   * Get a resource by ID
   */
  async getResource(
    resourceId: string,
    shopId?: string
  ): Promise<ResourceWithServices | null> {
    let query = this.db
      .from('reservation_resources')
      .select(`
        *,
        services:reservation_resource_services(
          *,
          service:reservation_services(*)
        ),
        availability:reservation_availability(*)
      `)
      .eq('id', resourceId);

    if (shopId) {
      query = query.eq('shop_id', shopId);
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return data as ResourceWithServices;
  }

  /**
   * List resources for a shop
   */
  async listResources(
    shopId: string,
    options: {
      active_only?: boolean;
      type?: string;
      service_id?: string;
    } = {}
  ): Promise<ReservationResourceRow[]> {
    let query = this.db
      .from('reservation_resources')
      .select('*')
      .eq('shop_id', shopId)
      .order('sort_order')
      .order('name');

    if (options.active_only) {
      query = query.eq('is_active', true);
    }

    if (options.type) {
      query = query.eq('type', options.type);
    }

    const { data, error } = await query;

    if (error) throw error;

    // If filtering by service, get resources that can provide it
    if (options.service_id && data) {
      const { data: resourceServices } = await this.db
        .from('reservation_resource_services')
        .select('resource_id')
        .eq('service_id', options.service_id)
        .eq('is_active', true);

      const resourceIds = new Set(resourceServices?.map(rs => rs.resource_id) || []);
      return data.filter(r => resourceIds.has(r.id));
    }

    return data || [];
  }

  /**
   * Delete a resource
   */
  async deleteResource(resourceId: string, shopId: string): Promise<void> {
    // Check for existing reservations
    const { data: reservations } = await this.db
      .from('reservations')
      .select('id')
      .eq('resource_id', resourceId)
      .limit(1);

    if (reservations && reservations.length > 0) {
      // Soft delete by deactivating
      await this.db
        .from('reservation_resources')
        .update({ is_active: false })
        .eq('id', resourceId)
        .eq('shop_id', shopId);
    } else {
      // Hard delete if no reservations
      const { error } = await this.db
        .from('reservation_resources')
        .delete()
        .eq('id', resourceId)
        .eq('shop_id', shopId);

      if (error) throw error;
    }
  }

  // ============================================
  // Resource-Service Links
  // ============================================

  /**
   * Set services for a resource
   */
  async setResourceServices(
    resourceId: string,
    shopId: string,
    services: {
      service_id: string;
      price_override?: number | null;
      duration_override?: number | null;
      is_active?: boolean;
    }[]
  ): Promise<ReservationResourceServiceRow[]> {
    // Verify resource belongs to shop
    const resource = await this.getResource(resourceId, shopId);
    if (!resource) throw new Error('Resource not found');

    // Delete existing links
    await this.db
      .from('reservation_resource_services')
      .delete()
      .eq('resource_id', resourceId);

    // Insert new links
    const insertData = services.map(s => ({
      resource_id: resourceId,
      service_id: s.service_id,
      price_override: s.price_override ?? null,
      duration_override: s.duration_override ?? null,
      is_active: s.is_active ?? true,
    }));

    const { data, error } = await this.db
      .from('reservation_resource_services')
      .insert(insertData)
      .select();

    if (error) throw error;
    return data;
  }

  /**
   * Get services for a resource
   */
  async getResourceServices(
    resourceId: string
  ): Promise<(ReservationResourceServiceRow & { service: ReservationServiceRow })[]> {
    const { data, error } = await this.db
      .from('reservation_resource_services')
      .select(`
        *,
        service:reservation_services(*)
      `)
      .eq('resource_id', resourceId)
      .eq('is_active', true);

    if (error) throw error;
    return (data || []) as (ReservationResourceServiceRow & { service: ReservationServiceRow })[];
  }

  /**
   * Get resources for a service
   */
  async getServiceResources(
    serviceId: string
  ): Promise<(ReservationResourceServiceRow & { resource: ReservationResourceRow })[]> {
    const { data, error } = await this.db
      .from('reservation_resource_services')
      .select(`
        *,
        resource:reservation_resources(*)
      `)
      .eq('service_id', serviceId)
      .eq('is_active', true);

    if (error) throw error;
    return (data || []) as (ReservationResourceServiceRow & { resource: ReservationResourceRow })[];
  }
}
