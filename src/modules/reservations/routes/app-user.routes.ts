/**
 * App User Reservation Routes
 * Routes for authenticated app users to manage their reservations
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { supabase } from '../../../config/database';
import { authenticateUser, requireCustomer } from '../../../middleware/unified-auth';
import { ReservationService, AvailabilityService, ResourceService } from '../services';
import {
  createReservationSchema,
  reservationWithDetailsSchema,
  cancelReservationSchema,
} from '../reservation.schemas';

// Define context type for app user routes
type AppUserEnv = {
  Variables: {
    appUser: { id: string; email: string; first_name: string | null; last_name: string | null };
    user: { id: string; email?: string };
    userType: string;
    userRole: string;
  };
};

const app = new OpenAPIHono<AppUserEnv>();

// Apply app user auth to all routes
app.use('/*', authenticateUser);
app.use('/*', requireCustomer);

// ============================================
// User Reservations
// ============================================

const listMyReservationsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['App User - Reservations'],
  summary: 'List my reservations',
  request: {
    query: z.object({
      status: z.string().optional(),
      upcoming_only: z.string().optional(),
      limit: z.string().optional(),
      offset: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of reservations',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.array(reservationWithDetailsSchema),
            count: z.number(),
          }),
        },
      },
    },
  },
});

app.openapi(listMyReservationsRoute, async (c) => {
  const appUser = c.get('appUser');
  const { status, upcoming_only, limit, offset } = c.req.valid('query');
  const reservationService = new ReservationService(supabase);

  const { data, count } = await reservationService.listUserReservations(appUser.id, {
    status: status ? status.split(',') : undefined,
    upcoming_only: upcoming_only === 'true',
    limit: limit ? parseInt(limit) : undefined,
    offset: offset ? parseInt(offset) : undefined,
  });

  return c.json({ success: true, data, count });
});

const getMyReservationRoute = createRoute({
  method: 'get',
  path: '/:reservationId',
  tags: ['App User - Reservations'],
  summary: 'Get my reservation details',
  request: {
    params: z.object({
      reservationId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Reservation details',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: reservationWithDetailsSchema,
          }),
        },
      },
    },
    404: {
      description: 'Reservation not found',
    },
  },
});

app.openapi(getMyReservationRoute, async (c) => {
  const appUser = c.get('appUser');
  const { reservationId } = c.req.valid('param');
  const reservationService = new ReservationService(supabase);

  const reservation = await reservationService.getReservation(reservationId);

  if (!reservation || reservation.app_user_id !== appUser.id) {
    return c.json({ success: false, error: 'Reservation not found' }, 404);
  }

  return c.json({ success: true, data: reservation });
});

// ============================================
// Create Reservation
// ============================================

const createReservationRoute = createRoute({
  method: 'post',
  path: '/shops/:shopId',
  tags: ['App User - Reservations'],
  summary: 'Create a reservation',
  request: {
    params: z.object({
      shopId: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: createReservationSchema,
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
            data: reservationWithDetailsSchema,
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

app.openapi(createReservationRoute, async (c) => {
  const appUser = c.get('appUser');
  const { shopId } = c.req.valid('param');
  const body = c.req.valid('json');
  const reservationService = new ReservationService(supabase);

  // Check if reservations enabled
  const enabled = await reservationService.isReservationsEnabled(shopId);
  if (!enabled) {
    return c.json({ success: false, error: 'Reservations not enabled' }, 404);
  }

  // Check if user is blocked from making reservations
  const { data: userData } = await supabase
    .from('app_users')
    .select('reservation_blocked_until')
    .eq('id', appUser.id)
    .single();

  if (userData?.reservation_blocked_until) {
    const blockedUntil = new Date(userData.reservation_blocked_until);
    if (blockedUntil > new Date()) {
      return c.json({
        success: false,
        error: `You are blocked from making reservations until ${blockedUntil.toLocaleDateString()}`,
      }, 403);
    }
  }

  try {
    const reservation = await reservationService.createReservation(shopId, {
      service_id: body.service_id,
      resource_id: body.resource_id,
      start_time: body.start_time,
      party_size: body.party_size,
      customer_notes: body.customer_notes,
      app_user_id: appUser.id,
    });

    const reservationWithDetails = await reservationService.getReservation(reservation.id);

    const message = reservation.status === 'confirmed'
      ? 'Your reservation has been confirmed!'
      : 'Your reservation is pending confirmation. We will notify you shortly.';

    return c.json({ success: true, data: reservationWithDetails, message }, 201);
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create reservation',
    }, 400);
  }
});

// ============================================
// Cancel Reservation
// ============================================

const cancelReservationRoute = createRoute({
  method: 'post',
  path: '/:reservationId/cancel',
  tags: ['App User - Reservations'],
  summary: 'Cancel my reservation',
  request: {
    params: z.object({
      reservationId: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: cancelReservationSchema,
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
            data: reservationWithDetailsSchema,
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

app.openapi(cancelReservationRoute, async (c) => {
  const appUser = c.get('appUser');
  const { reservationId } = c.req.valid('param');
  const { cancellation_reason } = c.req.valid('json');
  const reservationService = new ReservationService(supabase);

  // Verify ownership
  const reservation = await reservationService.getReservation(reservationId);
  if (!reservation || reservation.app_user_id !== appUser.id) {
    return c.json({ success: false, error: 'Reservation not found' }, 404);
  }

  try {
    await reservationService.cancelReservation(
      reservationId,
      appUser.id,
      cancellation_reason,
      false // not shop admin
    );

    const cancelled = await reservationService.getReservation(reservationId);
    return c.json({ success: true, data: cancelled });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to cancel reservation',
    }, 400);
  }
});

// ============================================
// Browse Services & Availability
// ============================================

const browseShopServicesRoute = createRoute({
  method: 'get',
  path: '/shops/:shopId/services',
  tags: ['App User - Reservations'],
  summary: 'Browse shop services',
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
            data: z.array(z.any()),
          }),
        },
      },
    },
  },
});

app.openapi(browseShopServicesRoute, async (c) => {
  const { shopId } = c.req.valid('param');
  const reservationService = new ReservationService(supabase);
  const resourceService = new ResourceService(supabase);

  // Check if reservations enabled
  const enabled = await reservationService.isReservationsEnabled(shopId);
  if (!enabled) {
    return c.json({ success: false, error: 'Reservations not enabled' }, 404);
  }

  const services = await resourceService.listServices(shopId, { active_only: true });

  return c.json({ success: true, data: services });
});

const getShopAvailabilityRoute = createRoute({
  method: 'get',
  path: '/shops/:shopId/availability',
  tags: ['App User - Reservations'],
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
            data: z.array(z.any()),
          }),
        },
      },
    },
  },
});

app.openapi(getShopAvailabilityRoute, async (c) => {
  const { shopId } = c.req.valid('param');
  const { service_id, resource_id, date_from, date_to } = c.req.valid('query');
  const reservationService = new ReservationService(supabase);
  const availabilityService = new AvailabilityService(supabase);

  // Check if reservations enabled
  const enabled = await reservationService.isReservationsEnabled(shopId);
  if (!enabled) {
    return c.json({ success: false, error: 'Reservations not enabled' }, 404);
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

export default app;
