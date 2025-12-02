/**
 * Public Reservation Routes
 * Routes for checking availability and making guest reservations
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { supabase } from '../../../config/database';
import { ReservationService, AvailabilityService, ResourceService } from '../services';
import {
  serviceResponseSchema,
  resourceResponseSchema,
  createReservationSchema,
  reservationResponseSchema,
  getAvailabilityQuerySchema,
  dayAvailabilitySchema,
} from '../reservation.schemas';

const app = new OpenAPIHono();

// ============================================
// Shop Info Routes
// ============================================

const getShopReservationInfoRoute = createRoute({
  method: 'get',
  path: '/:shopId',
  tags: ['Public - Reservations'],
  summary: 'Get shop reservation info',
  request: {
    params: z.object({
      shopId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Shop reservation info',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              shop_id: z.string().uuid(),
              shop_name: z.string(),
              reservations_enabled: z.boolean(),
              settings: z.object({
                max_advance_days: z.number(),
                min_advance_hours: z.number(),
                cancellation_hours: z.number(),
              }),
            }),
          }),
        },
      },
    },
    404: {
      description: 'Shop not found',
    },
  },
});

app.openapi(getShopReservationInfoRoute, async (c) => {
  const { shopId } = c.req.valid('param');
    const reservationService = new ReservationService(supabase);

  // Check if shop exists and has reservations enabled
  const { data: shop, error } = await supabase
    .from('shops')
    .select('id, name, reservations_enabled, reservation_settings')
    .eq('id', shopId)
    .single();

  if (error || !shop) {
    return c.json({ success: false, error: 'Shop not found' }, 404);
  }

  if (!shop.reservations_enabled) {
    return c.json({ success: false, error: 'Reservations not enabled for this shop' }, 404);
  }

  const settings = await reservationService.getShopSettings(shopId);

  return c.json({
    success: true,
    data: {
      shop_id: shop.id,
      shop_name: shop.name,
      reservations_enabled: shop.reservations_enabled,
      settings: {
        max_advance_days: settings.max_advance_days,
        min_advance_hours: settings.min_advance_hours,
        cancellation_hours: settings.cancellation_hours,
      },
    },
  });
});

// ============================================
// Services Routes
// ============================================

const listPublicServicesRoute = createRoute({
  method: 'get',
  path: '/:shopId/services',
  tags: ['Public - Reservations'],
  summary: 'List available services',
  request: {
    params: z.object({
      shopId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'List of services',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.array(serviceResponseSchema),
          }),
        },
      },
    },
  },
});

app.openapi(listPublicServicesRoute, async (c) => {
  const { shopId } = c.req.valid('param');
    const resourceService = new ResourceService(supabase);
  const reservationService = new ReservationService(supabase);

  // Check if reservations enabled
  const enabled = await reservationService.isReservationsEnabled(shopId);
  if (!enabled) {
    return c.json({ success: false, error: 'Reservations not enabled' }, 404);
  }

  const services = await resourceService.listServices(shopId, { active_only: true });

  return c.json({ success: true, data: services });
});

const getPublicServiceRoute = createRoute({
  method: 'get',
  path: '/:shopId/services/:serviceId',
  tags: ['Public - Reservations'],
  summary: 'Get service details with resources',
  request: {
    params: z.object({
      shopId: z.string().uuid(),
      serviceId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Service details',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: serviceResponseSchema.extend({
              resources: z.array(resourceResponseSchema.extend({
                price_override: z.number().nullable(),
                duration_override: z.number().nullable(),
              })).optional(),
            }),
          }),
        },
      },
    },
    404: {
      description: 'Service not found',
    },
  },
});

app.openapi(getPublicServiceRoute, async (c) => {
  const { shopId, serviceId } = c.req.valid('param');
    const resourceService = new ResourceService(supabase);

  const service = await resourceService.getService(serviceId, shopId);

  if (!service || !service.is_active) {
    return c.json({ success: false, error: 'Service not found' }, 404);
  }

  // Filter to only active resources
  if (service.resources) {
    service.resources = service.resources.filter((r: any) => r.is_active);
  }

  return c.json({ success: true, data: service });
});

// ============================================
// Resources Routes
// ============================================

const listPublicResourcesRoute = createRoute({
  method: 'get',
  path: '/:shopId/resources',
  tags: ['Public - Reservations'],
  summary: 'List available resources',
  request: {
    params: z.object({
      shopId: z.string().uuid(),
    }),
    query: z.object({
      service_id: z.string().uuid().optional(),
      type: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of resources',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.array(resourceResponseSchema),
          }),
        },
      },
    },
  },
});

app.openapi(listPublicResourcesRoute, async (c) => {
  const { shopId } = c.req.valid('param');
  const { service_id, type } = c.req.valid('query');
    const resourceService = new ResourceService(supabase);

  const resources = await resourceService.listResources(shopId, {
    active_only: true,
    type,
    service_id,
  });

  return c.json({ success: true, data: resources });
});

// ============================================
// Availability Routes
// ============================================

const getAvailabilityRoute = createRoute({
  method: 'get',
  path: '/:shopId/availability',
  tags: ['Public - Reservations'],
  summary: 'Get available time slots',
  request: {
    params: z.object({
      shopId: z.string().uuid(),
    }),
    query: z.object({
      service_id: z.string().uuid(),
      resource_id: z.string().uuid().optional(),
      date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
      date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    }),
  },
  responses: {
    200: {
      description: 'Available time slots',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.array(dayAvailabilitySchema),
          }),
        },
      },
    },
  },
});

app.openapi(getAvailabilityRoute, async (c) => {
  const { shopId } = c.req.valid('param');
  const { service_id, resource_id, date_from, date_to } = c.req.valid('query');
    const availabilityService = new AvailabilityService(supabase);
  const reservationService = new ReservationService(supabase);

  // Check if reservations enabled
  const enabled = await reservationService.isReservationsEnabled(shopId);
  if (!enabled) {
    return c.json({ success: false, error: 'Reservations not enabled' }, 404);
  }

  // Validate date range
  const settings = await reservationService.getShopSettings(shopId);
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + settings.max_advance_days);

  const toDate = new Date(date_to);
  if (toDate > maxDate) {
    return c.json({
      success: false,
      error: `Cannot check availability more than ${settings.max_advance_days} days in advance`,
    }, 400);
  }

  const availability = await availabilityService.getAvailability(
    shopId,
    service_id,
    date_from,
    date_to,
    resource_id
  );

  return c.json({ success: true, data: availability });
});

const getNextAvailableRoute = createRoute({
  method: 'get',
  path: '/:shopId/availability/next',
  tags: ['Public - Reservations'],
  summary: 'Get next available slot',
  request: {
    params: z.object({
      shopId: z.string().uuid(),
    }),
    query: z.object({
      service_id: z.string().uuid(),
      resource_id: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Next available slot',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              start_time: z.string(),
              end_time: z.string(),
              available: z.boolean(),
              resource_id: z.string().uuid().nullable().optional(),
              resource_name: z.string().nullable().optional(),
            }).nullable(),
          }),
        },
      },
    },
  },
});

app.openapi(getNextAvailableRoute, async (c) => {
  const { shopId } = c.req.valid('param');
  const { service_id, resource_id } = c.req.valid('query');
    const availabilityService = new AvailabilityService(supabase);

  const nextSlot = await availabilityService.getNextAvailableSlot(
    shopId,
    service_id,
    resource_id
  );

  return c.json({ success: true, data: nextSlot });
});

// ============================================
// Guest Reservation Routes
// ============================================

const createGuestReservationRoute = createRoute({
  method: 'post',
  path: '/:shopId/reservations',
  tags: ['Public - Reservations'],
  summary: 'Create a guest reservation',
  request: {
    params: z.object({
      shopId: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: createReservationSchema.extend({
            guest_name: z.string().min(1).max(255),
            guest_phone: z.string().min(5).max(50).optional(),
            guest_email: z.string().email().max(255).optional(),
          }).refine(
            data => data.guest_phone || data.guest_email,
            { message: 'Either phone or email is required for guest reservations' }
          ),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Reservation created',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: reservationResponseSchema,
            message: z.string(),
          }),
        },
      },
    },
    400: {
      description: 'Invalid request',
    },
  },
});

app.openapi(createGuestReservationRoute, async (c) => {
  const { shopId } = c.req.valid('param');
  const body = c.req.valid('json');
    const reservationService = new ReservationService(supabase);

  // Check if reservations enabled
  const enabled = await reservationService.isReservationsEnabled(shopId);
  if (!enabled) {
    return c.json({ success: false, error: 'Reservations not enabled' }, 404);
  }

  try {
    const reservation = await reservationService.createReservation(shopId, {
      service_id: body.service_id,
      resource_id: body.resource_id,
      start_time: body.start_time,
      party_size: body.party_size,
      customer_notes: body.customer_notes,
      guest_name: body.guest_name,
      guest_phone: body.guest_phone,
      guest_email: body.guest_email,
    });

    const message = reservation.status === 'confirmed'
      ? 'Your reservation has been confirmed!'
      : 'Your reservation is pending confirmation. We will notify you shortly.';

    return c.json({ success: true, data: reservation, message }, 201);
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create reservation',
    }, 400);
  }
});

const getGuestReservationRoute = createRoute({
  method: 'get',
  path: '/:shopId/reservations/:reservationId',
  tags: ['Public - Reservations'],
  summary: 'Get a reservation by ID (for guests)',
  request: {
    params: z.object({
      shopId: z.string().uuid(),
      reservationId: z.string().uuid(),
    }),
    query: z.object({
      email: z.string().email().optional(),
      phone: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Reservation details',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: reservationResponseSchema,
          }),
        },
      },
    },
    404: {
      description: 'Reservation not found',
    },
  },
});

app.openapi(getGuestReservationRoute, async (c) => {
  const { shopId, reservationId } = c.req.valid('param');
  const { email, phone } = c.req.valid('query');
    const reservationService = new ReservationService(supabase);

  const reservation = await reservationService.getReservation(reservationId, shopId);

  if (!reservation) {
    return c.json({ success: false, error: 'Reservation not found' }, 404);
  }

  // Verify guest identity (must match email or phone)
  if (reservation.app_user_id) {
    return c.json({ success: false, error: 'This is not a guest reservation' }, 403);
  }

  const emailMatch = email && reservation.guest_email?.toLowerCase() === email.toLowerCase();
  const phoneMatch = phone && reservation.guest_phone === phone;

  if (!emailMatch && !phoneMatch) {
    return c.json({ success: false, error: 'Reservation not found' }, 404);
  }

  return c.json({ success: true, data: reservation });
});

const cancelGuestReservationRoute = createRoute({
  method: 'post',
  path: '/:shopId/reservations/:reservationId/cancel',
  tags: ['Public - Reservations'],
  summary: 'Cancel a guest reservation',
  request: {
    params: z.object({
      shopId: z.string().uuid(),
      reservationId: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            email: z.string().email().optional(),
            phone: z.string().optional(),
            reason: z.string().max(500).optional(),
          }).refine(
            data => data.email || data.phone,
            { message: 'Either email or phone is required to cancel' }
          ),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Reservation cancelled',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: reservationResponseSchema,
          }),
        },
      },
    },
    400: {
      description: 'Cannot cancel',
    },
    404: {
      description: 'Reservation not found',
    },
  },
});

app.openapi(cancelGuestReservationRoute, async (c) => {
  const { shopId, reservationId } = c.req.valid('param');
  const { email, phone, reason } = c.req.valid('json');
    const reservationService = new ReservationService(supabase);

  const reservation = await reservationService.getReservation(reservationId, shopId);

  if (!reservation) {
    return c.json({ success: false, error: 'Reservation not found' }, 404);
  }

  // Verify guest identity
  if (reservation.app_user_id) {
    return c.json({ success: false, error: 'This is not a guest reservation' }, 403);
  }

  const emailMatch = email && reservation.guest_email?.toLowerCase() === email.toLowerCase();
  const phoneMatch = phone && reservation.guest_phone === phone;

  if (!emailMatch && !phoneMatch) {
    return c.json({ success: false, error: 'Reservation not found' }, 404);
  }

  try {
    const cancelled = await reservationService.cancelReservation(
      reservationId,
      'guest',
      reason,
      false,
      shopId
    );

    return c.json({ success: true, data: cancelled });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel reservation',
    }, 400);
  }
});

export default app;
