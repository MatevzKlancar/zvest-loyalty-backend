/**
 * Shop Admin Reservation Routes
 * Routes for shop owners to manage their reservation system
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { supabase } from '../../../config/database';
import { authenticateUser, requireShopOwner } from '../../../middleware/unified-auth';
import { ReservationService, AvailabilityService, ResourceService } from '../services';
import {
  createServiceSchema,
  updateServiceSchema,
  serviceResponseSchema,
  createResourceSchema,
  updateResourceSchema,
  resourceResponseSchema,
  setResourceServicesSchema,
  resourceServiceResponseSchema,
  setAvailabilitySchema,
  availabilityResponseSchema,
  createBlockSchema,
  blockResponseSchema,
  updateReservationSchema,
  reservationWithDetailsSchema,
  updateReservationSettingsSchema,
  reservationSettingsSchema,
} from '../reservation.schemas';

// Define context type for shop admin routes
type ShopAdminEnv = {
  Variables: {
    shop: { id: string; name: string; status: string };
    user: { id: string; email?: string };
    userType: string;
    userRole: string;
  };
};

const app = new OpenAPIHono<ShopAdminEnv>();

// Apply shop owner auth to all routes
app.use('/*', authenticateUser);
app.use('/*', requireShopOwner);

// ============================================
// Settings Routes
// ============================================

const getSettingsRoute = createRoute({
  method: 'get',
  path: '/settings',
  tags: ['Shop Admin - Reservations'],
  summary: 'Get reservation settings',
  responses: {
    200: {
      description: 'Reservation settings',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: reservationSettingsSchema,
          }),
        },
      },
    },
  },
});

app.openapi(getSettingsRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const service = new ReservationService(supabase);

  const settings = await service.getShopSettings(shopId);

  return c.json({ success: true, data: settings });
});

const updateSettingsRoute = createRoute({
  method: 'patch',
  path: '/settings',
  tags: ['Shop Admin - Reservations'],
  summary: 'Update reservation settings',
  request: {
    body: {
      content: {
        'application/json': {
          schema: updateReservationSettingsSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated settings',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: reservationSettingsSchema,
          }),
        },
      },
    },
  },
});

app.openapi(updateSettingsRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const body = c.req.valid('json');
  const service = new ReservationService(supabase);

  // Get current settings and merge
  const currentSettings = await service.getShopSettings(shopId);
  const newSettings = { ...currentSettings, ...body };

  // Update shop
  await supabase
    .from('shops')
    .update({ reservation_settings: newSettings })
    .eq('id', shopId);

  return c.json({ success: true, data: newSettings });
});

const toggleReservationsRoute = createRoute({
  method: 'post',
  path: '/toggle',
  tags: ['Shop Admin - Reservations'],
  summary: 'Enable or disable reservations',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            enabled: z.boolean(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Reservations toggled',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            reservations_enabled: z.boolean(),
          }),
        },
      },
    },
  },
});

app.openapi(toggleReservationsRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { enabled } = c.req.valid('json');

  await supabase
    .from('shops')
    .update({ reservations_enabled: enabled })
    .eq('id', shopId);

  return c.json({ success: true, reservations_enabled: enabled });
});

// ============================================
// Service Routes
// ============================================

const listServicesRoute = createRoute({
  method: 'get',
  path: '/services',
  tags: ['Shop Admin - Reservations'],
  summary: 'List all services',
  request: {
    query: z.object({
      active_only: z.string().optional(),
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

app.openapi(listServicesRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { active_only } = c.req.valid('query');
    const resourceService = new ResourceService(supabase);

  const services = await resourceService.listServices(shopId, {
    active_only: active_only === 'true',
  });

  return c.json({ success: true, data: services });
});

const createServiceRoute = createRoute({
  method: 'post',
  path: '/services',
  tags: ['Shop Admin - Reservations'],
  summary: 'Create a service',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createServiceSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Service created',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: serviceResponseSchema,
          }),
        },
      },
    },
  },
});

app.openapi(createServiceRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const body = c.req.valid('json');
    const resourceService = new ResourceService(supabase);

  const service = await resourceService.createService(shopId, body);

  return c.json({ success: true, data: service }, 201);
});

const getServiceRoute = createRoute({
  method: 'get',
  path: '/services/:serviceId',
  tags: ['Shop Admin - Reservations'],
  summary: 'Get a service with resources',
  request: {
    params: z.object({
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

app.openapi(getServiceRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { serviceId } = c.req.valid('param');
    const resourceService = new ResourceService(supabase);

  const service = await resourceService.getService(serviceId, shopId);

  if (!service) {
    return c.json({ success: false, error: 'Service not found' }, 404);
  }

  return c.json({ success: true, data: service });
});

const updateServiceRoute = createRoute({
  method: 'patch',
  path: '/services/:serviceId',
  tags: ['Shop Admin - Reservations'],
  summary: 'Update a service',
  request: {
    params: z.object({
      serviceId: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateServiceSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Service updated',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: serviceResponseSchema,
          }),
        },
      },
    },
  },
});

app.openapi(updateServiceRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { serviceId } = c.req.valid('param');
  const body = c.req.valid('json');
    const resourceService = new ResourceService(supabase);

  const service = await resourceService.updateService(serviceId, shopId, body);

  return c.json({ success: true, data: service });
});

const deleteServiceRoute = createRoute({
  method: 'delete',
  path: '/services/:serviceId',
  tags: ['Shop Admin - Reservations'],
  summary: 'Delete a service',
  request: {
    params: z.object({
      serviceId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Service deleted',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
          }),
        },
      },
    },
  },
});

app.openapi(deleteServiceRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { serviceId } = c.req.valid('param');
    const resourceService = new ResourceService(supabase);

  await resourceService.deleteService(serviceId, shopId);

  return c.json({ success: true });
});

// ============================================
// Resource Routes
// ============================================

const listResourcesRoute = createRoute({
  method: 'get',
  path: '/resources',
  tags: ['Shop Admin - Reservations'],
  summary: 'List all resources',
  request: {
    query: z.object({
      active_only: z.string().optional(),
      type: z.string().optional(),
      service_id: z.string().uuid().optional(),
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

app.openapi(listResourcesRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { active_only, type, service_id } = c.req.valid('query');
    const resourceService = new ResourceService(supabase);

  const resources = await resourceService.listResources(shopId, {
    active_only: active_only === 'true',
    type,
    service_id,
  });

  return c.json({ success: true, data: resources });
});

const createResourceRoute = createRoute({
  method: 'post',
  path: '/resources',
  tags: ['Shop Admin - Reservations'],
  summary: 'Create a resource',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createResourceSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Resource created',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: resourceResponseSchema,
          }),
        },
      },
    },
  },
});

app.openapi(createResourceRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const body = c.req.valid('json');
    const resourceService = new ResourceService(supabase);

  const resource = await resourceService.createResource(shopId, body);

  return c.json({ success: true, data: resource }, 201);
});

const getResourceRoute = createRoute({
  method: 'get',
  path: '/resources/:resourceId',
  tags: ['Shop Admin - Reservations'],
  summary: 'Get a resource with services and availability',
  request: {
    params: z.object({
      resourceId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Resource details',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: resourceResponseSchema,
          }),
        },
      },
    },
    404: {
      description: 'Resource not found',
    },
  },
});

app.openapi(getResourceRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { resourceId } = c.req.valid('param');
    const resourceService = new ResourceService(supabase);

  const resource = await resourceService.getResource(resourceId, shopId);

  if (!resource) {
    return c.json({ success: false, error: 'Resource not found' }, 404);
  }

  return c.json({ success: true, data: resource });
});

const updateResourceRoute = createRoute({
  method: 'patch',
  path: '/resources/:resourceId',
  tags: ['Shop Admin - Reservations'],
  summary: 'Update a resource',
  request: {
    params: z.object({
      resourceId: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateResourceSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Resource updated',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: resourceResponseSchema,
          }),
        },
      },
    },
  },
});

app.openapi(updateResourceRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { resourceId } = c.req.valid('param');
  const body = c.req.valid('json');
    const resourceService = new ResourceService(supabase);

  const resource = await resourceService.updateResource(resourceId, shopId, body);

  return c.json({ success: true, data: resource });
});

const deleteResourceRoute = createRoute({
  method: 'delete',
  path: '/resources/:resourceId',
  tags: ['Shop Admin - Reservations'],
  summary: 'Delete a resource',
  request: {
    params: z.object({
      resourceId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Resource deleted',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
          }),
        },
      },
    },
  },
});

app.openapi(deleteResourceRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { resourceId } = c.req.valid('param');
    const resourceService = new ResourceService(supabase);

  await resourceService.deleteResource(resourceId, shopId);

  return c.json({ success: true });
});

// ============================================
// Resource-Service Links
// ============================================

const setResourceServicesRoute = createRoute({
  method: 'put',
  path: '/resources/:resourceId/services',
  tags: ['Shop Admin - Reservations'],
  summary: 'Set services for a resource',
  request: {
    params: z.object({
      resourceId: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: setResourceServicesSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Services set',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.array(resourceServiceResponseSchema),
          }),
        },
      },
    },
  },
});

app.openapi(setResourceServicesRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { resourceId } = c.req.valid('param');
  const { services } = c.req.valid('json');
    const resourceService = new ResourceService(supabase);

  const resourceServices = await resourceService.setResourceServices(
    resourceId,
    shopId,
    services
  );

  return c.json({ success: true, data: resourceServices });
});

// ============================================
// Availability Routes
// ============================================

const getAvailabilityScheduleRoute = createRoute({
  method: 'get',
  path: '/availability',
  tags: ['Shop Admin - Reservations'],
  summary: 'Get availability schedule',
  request: {
    query: z.object({
      resource_id: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Availability schedule',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.array(availabilityResponseSchema),
          }),
        },
      },
    },
  },
});

app.openapi(getAvailabilityScheduleRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { resource_id } = c.req.valid('query');
    const availabilityService = new AvailabilityService(supabase);

  const schedule = await availabilityService.getAvailabilitySchedule(
    shopId,
    resource_id || null
  );

  return c.json({ success: true, data: schedule });
});

const setAvailabilityRoute = createRoute({
  method: 'put',
  path: '/availability',
  tags: ['Shop Admin - Reservations'],
  summary: 'Set availability schedule',
  request: {
    body: {
      content: {
        'application/json': {
          schema: setAvailabilitySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Availability set',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.array(availabilityResponseSchema),
          }),
        },
      },
    },
  },
});

app.openapi(setAvailabilityRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { resource_id, availability } = c.req.valid('json');
    const availabilityService = new AvailabilityService(supabase);

  const schedule = await availabilityService.setAvailability(
    shopId,
    resource_id || null,
    availability
  );

  return c.json({ success: true, data: schedule });
});

// ============================================
// Block Routes
// ============================================

const listBlocksRoute = createRoute({
  method: 'get',
  path: '/blocks',
  tags: ['Shop Admin - Reservations'],
  summary: 'List blocks',
  request: {
    query: z.object({
      resource_id: z.string().uuid().optional(),
      from_date: z.string().optional(),
      to_date: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of blocks',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.array(blockResponseSchema),
          }),
        },
      },
    },
  },
});

app.openapi(listBlocksRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { resource_id, from_date, to_date } = c.req.valid('query');
    const availabilityService = new AvailabilityService(supabase);

  const blocks = await availabilityService.listBlocks(shopId, {
    resource_id: resource_id || undefined,
    from_date,
    to_date,
  });

  return c.json({ success: true, data: blocks });
});

const createBlockRoute = createRoute({
  method: 'post',
  path: '/blocks',
  tags: ['Shop Admin - Reservations'],
  summary: 'Create a block',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createBlockSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Block created',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: blockResponseSchema,
          }),
        },
      },
    },
  },
});

app.openapi(createBlockRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const body = c.req.valid('json');
    const availabilityService = new AvailabilityService(supabase);

  const block = await availabilityService.createBlock(shopId, body);

  return c.json({ success: true, data: block }, 201);
});

const deleteBlockRoute = createRoute({
  method: 'delete',
  path: '/blocks/:blockId',
  tags: ['Shop Admin - Reservations'],
  summary: 'Delete a block',
  request: {
    params: z.object({
      blockId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Block deleted',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
          }),
        },
      },
    },
  },
});

app.openapi(deleteBlockRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { blockId } = c.req.valid('param');
    const availabilityService = new AvailabilityService(supabase);

  await availabilityService.deleteBlock(blockId, shopId);

  return c.json({ success: true });
});

// ============================================
// Reservation Management Routes
// ============================================

const listReservationsRoute = createRoute({
  method: 'get',
  path: '/reservations',
  tags: ['Shop Admin - Reservations'],
  summary: 'List reservations',
  request: {
    query: z.object({
      status: z.string().optional(),
      resource_id: z.string().uuid().optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
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

app.openapi(listReservationsRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { status, resource_id, date_from, date_to, limit, offset } = c.req.valid('query');
    const reservationService = new ReservationService(supabase);

  const { data, count } = await reservationService.listReservations(shopId, {
    status: status ? status.split(',') : undefined,
    resource_id,
    date_from,
    date_to,
    limit: limit ? parseInt(limit) : undefined,
    offset: offset ? parseInt(offset) : undefined,
  });

  return c.json({ success: true, data, count });
});

const getReservationRoute = createRoute({
  method: 'get',
  path: '/reservations/:reservationId',
  tags: ['Shop Admin - Reservations'],
  summary: 'Get a reservation',
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

app.openapi(getReservationRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { reservationId } = c.req.valid('param');
    const reservationService = new ReservationService(supabase);

  const reservation = await reservationService.getReservation(reservationId, shopId);

  if (!reservation) {
    return c.json({ success: false, error: 'Reservation not found' }, 404);
  }

  return c.json({ success: true, data: reservation });
});

const updateReservationRoute = createRoute({
  method: 'patch',
  path: '/reservations/:reservationId',
  tags: ['Shop Admin - Reservations'],
  summary: 'Update a reservation',
  request: {
    params: z.object({
      reservationId: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateReservationSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Reservation updated',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: reservationWithDetailsSchema,
          }),
        },
      },
    },
  },
});

app.openapi(updateReservationRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { reservationId } = c.req.valid('param');
  const body = c.req.valid('json');
    const reservationService = new ReservationService(supabase);

  await reservationService.updateReservation(reservationId, shopId, body);
  const reservation = await reservationService.getReservation(reservationId, shopId);

  return c.json({ success: true, data: reservation });
});

const confirmReservationRoute = createRoute({
  method: 'post',
  path: '/reservations/:reservationId/confirm',
  tags: ['Shop Admin - Reservations'],
  summary: 'Confirm a reservation',
  request: {
    params: z.object({
      reservationId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Reservation confirmed',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: reservationWithDetailsSchema,
          }),
        },
      },
    },
  },
});

app.openapi(confirmReservationRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const user = c.get('user');
  const userId = user.id;
  const { reservationId } = c.req.valid('param');
    const reservationService = new ReservationService(supabase);

  await reservationService.confirmReservation(reservationId, shopId, userId);
  const reservation = await reservationService.getReservation(reservationId, shopId);

  return c.json({ success: true, data: reservation });
});

const cancelReservationRoute = createRoute({
  method: 'post',
  path: '/reservations/:reservationId/cancel',
  tags: ['Shop Admin - Reservations'],
  summary: 'Cancel a reservation',
  request: {
    params: z.object({
      reservationId: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            reason: z.string().max(500).optional(),
          }),
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
  },
});

app.openapi(cancelReservationRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const user = c.get('user');
  const userId = user.id;
  const { reservationId } = c.req.valid('param');
  const { reason } = c.req.valid('json');
    const reservationService = new ReservationService(supabase);

  await reservationService.cancelReservation(
    reservationId,
    userId,
    reason,
    true, // isShopAdmin
    shopId
  );
  const reservation = await reservationService.getReservation(reservationId, shopId);

  return c.json({ success: true, data: reservation });
});

const completeReservationRoute = createRoute({
  method: 'post',
  path: '/reservations/:reservationId/complete',
  tags: ['Shop Admin - Reservations'],
  summary: 'Mark reservation as completed',
  request: {
    params: z.object({
      reservationId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Reservation completed',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: reservationWithDetailsSchema,
          }),
        },
      },
    },
  },
});

app.openapi(completeReservationRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { reservationId } = c.req.valid('param');
    const reservationService = new ReservationService(supabase);

  await reservationService.completeReservation(reservationId, shopId);
  const reservation = await reservationService.getReservation(reservationId, shopId);

  return c.json({ success: true, data: reservation });
});

const noShowReservationRoute = createRoute({
  method: 'post',
  path: '/reservations/:reservationId/no-show',
  tags: ['Shop Admin - Reservations'],
  summary: 'Mark reservation as no-show',
  request: {
    params: z.object({
      reservationId: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Reservation marked as no-show',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: reservationWithDetailsSchema,
          }),
        },
      },
    },
  },
});

app.openapi(noShowReservationRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { reservationId } = c.req.valid('param');
    const reservationService = new ReservationService(supabase);

  await reservationService.markNoShow(reservationId, shopId);
  const reservation = await reservationService.getReservation(reservationId, shopId);

  return c.json({ success: true, data: reservation });
});

const getStatsRoute = createRoute({
  method: 'get',
  path: '/stats',
  tags: ['Shop Admin - Reservations'],
  summary: 'Get reservation statistics',
  request: {
    query: z.object({
      date_from: z.string().optional(),
      date_to: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Reservation statistics',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.record(z.number()),
          }),
        },
      },
    },
  },
});

app.openapi(getStatsRoute, async (c) => {
  const shop = c.get('shop');
  const shopId = shop.id;
  const { date_from, date_to } = c.req.valid('query');
    const reservationService = new ReservationService(supabase);

  const stats = await reservationService.getReservationStats(shopId, date_from, date_to);

  return c.json({ success: true, data: stats });
});

export default app;
