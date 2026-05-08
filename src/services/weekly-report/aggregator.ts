import { SupabaseClient } from "@supabase/supabase-js";
import { getDatabaseForShop } from "../../config/database";
import { logger } from "../../config/logger";

export interface WeeklyStatsPacket {
  shop: { id: string; name: string; currency: string; loyalty_type: string | null };
  period: {
    current: { start: string; end: string };
    previous: { start: string; end: string };
  };
  revenue: {
    total: number;
    transaction_count: number;
    avg_basket: number;
    wow_change_pct: number | null;
    previous_total: number;
    by_day: Array<{ day: string; weekday: string; total: number; count: number }>;
    by_hour: Array<{ hour: number; total: number; count: number }>;
    best_day: { day: string; weekday: string; total: number } | null;
    worst_day: { day: string; weekday: string; total: number } | null;
    peak_hours: Array<{ hour: number; total: number }>;
    dead_hours: Array<{ hour: number; total: number }>;
    likely_closed_weekdays: string[];
  };
  coupons: {
    active_count: number;
    redemptions_this_week: number;
    total_discount_given: number;
    by_coupon: Array<{
      id: string;
      name: string;
      type: string;
      is_active: boolean;
      used_count: number;
      redemptions_this_week: number;
      discount_total_this_week: number;
    }>;
    underperformers: Array<{ id: string; name: string; reason: string }>;
  };
  customers: {
    new_count: number;
    returning_count: number;
    unique_active_this_week: number;
    avg_visits_per_returning: number;
    top_spenders: Array<{
      app_user_id: string;
      name: string | null;
      spent_this_week: number;
      total_spent: number;
    }>;
    at_risk: Array<{
      app_user_id: string;
      name: string | null;
      last_visit_at: string | null;
      days_since_visit: number;
      total_spent: number;
    }>;
  };
  products: {
    top_sellers: Array<{ name: string; units: number; revenue: number }>;
    slow_movers: Array<{ name: string; units: number; revenue: number }>;
  };
  loyalty: {
    program_type: string | null;
    points_awarded: number;
    points_redeemed: number;
    stamps_awarded: number;
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface AggregatorInput {
  shopId: string;
  shopName: string;
  loyaltyType?: string | null;
  weekOffset?: number;
}

export async function buildWeeklyStatsPacket(
  input: AggregatorInput
): Promise<WeeklyStatsPacket> {
  const offset = input.weekOffset ?? 0;
  const now = new Date();
  const currentEnd = new Date(now.getTime() - offset * 7 * 24 * 60 * 60 * 1000);
  const currentStart = new Date(currentEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const previousEnd = new Date(currentStart);
  const previousStart = new Date(previousEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

  const { client } = await getDatabaseForShop(input.shopId);

  const [revenue, coupons, customers, products, loyalty] = await Promise.all([
    aggregateRevenue(client, input.shopId, currentStart, currentEnd, previousStart, previousEnd),
    aggregateCoupons(client, input.shopId, currentStart, currentEnd),
    aggregateCustomers(client, input.shopId, currentStart, currentEnd),
    aggregateProducts(client, input.shopId, currentStart, currentEnd),
    aggregateLoyalty(client, input.shopId, currentStart, currentEnd, input.loyaltyType ?? null),
  ]);

  return {
    shop: {
      id: input.shopId,
      name: input.shopName,
      currency: "EUR",
      loyalty_type: input.loyaltyType ?? null,
    },
    period: {
      current: { start: currentStart.toISOString(), end: currentEnd.toISOString() },
      previous: { start: previousStart.toISOString(), end: previousEnd.toISOString() },
    },
    revenue,
    coupons,
    customers,
    products,
    loyalty,
  };
}

async function aggregateRevenue(
  client: SupabaseClient,
  shopId: string,
  start: Date,
  end: Date,
  prevStart: Date,
  prevEnd: Date
): Promise<WeeklyStatsPacket["revenue"]> {
  const { data: txs, error } = await client
    .from("transactions")
    .select("id, total_amount, created_at, status")
    .eq("shop_id", shopId)
    .neq("status", "cancelled")
    .gte("created_at", prevStart.toISOString())
    .lt("created_at", end.toISOString());

  if (error) {
    logger.error("Weekly report: failed to fetch revenue transactions:", error);
    throw new Error("Failed to aggregate revenue");
  }

  const current = (txs ?? []).filter((t) => new Date(t.created_at) >= start);
  const previous = (txs ?? []).filter((t) => new Date(t.created_at) < start);

  const total = current.reduce((s, t) => s + Number(t.total_amount), 0);
  const previousTotal = previous.reduce((s, t) => s + Number(t.total_amount), 0);
  const count = current.length;
  const avgBasket = count > 0 ? total / count : 0;
  const wow = previousTotal > 0 ? ((total - previousTotal) / previousTotal) * 100 : null;

  const byDay = new Map<string, { weekday: string; total: number; count: number }>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    byDay.set(isoDay(d), { weekday: WEEKDAYS[d.getDay()], total: 0, count: 0 });
  }
  const byHour = new Map<number, { total: number; count: number }>();
  for (let h = 0; h < 24; h++) byHour.set(h, { total: 0, count: 0 });

  for (const t of current) {
    const d = new Date(t.created_at);
    const key = isoDay(d);
    const dayBucket = byDay.get(key);
    if (dayBucket) {
      dayBucket.total += Number(t.total_amount);
      dayBucket.count += 1;
    }
    const hourBucket = byHour.get(d.getHours())!;
    hourBucket.total += Number(t.total_amount);
    hourBucket.count += 1;
  }

  const dayRows = Array.from(byDay.entries()).map(([day, v]) => ({
    day,
    weekday: v.weekday,
    total: round2(v.total),
    count: v.count,
  }));
  const sortedByDay = [...dayRows].sort((a, b) => b.total - a.total);
  const bestDay = sortedByDay[0]?.total ? sortedByDay[0] : null;
  const worstDay = sortedByDay[sortedByDay.length - 1] ?? null;

  const hourRows = Array.from(byHour.entries()).map(([hour, v]) => ({
    hour,
    total: round2(v.total),
    count: v.count,
  }));
  const activeHours = hourRows.filter((h) => h.count > 0);
  const peakHours = [...activeHours].sort((a, b) => b.total - a.total).slice(0, 3);
  const deadHours = [...activeHours].sort((a, b) => a.total - b.total).slice(0, 3);

  const prevByWeekday = new Map<number, number>();
  for (const t of previous) {
    const wd = new Date(t.created_at).getDay();
    prevByWeekday.set(wd, (prevByWeekday.get(wd) ?? 0) + 1);
  }
  const likelyClosedWeekdays: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    const wd = d.getDay();
    const currentCount = byDay.get(isoDay(d))?.count ?? 0;
    if (currentCount === 0 && (prevByWeekday.get(wd) ?? 0) === 0) {
      likelyClosedWeekdays.push(WEEKDAYS[wd]);
    }
  }

  return {
    total: round2(total),
    transaction_count: count,
    avg_basket: round2(avgBasket),
    wow_change_pct: wow === null ? null : Math.round(wow * 10) / 10,
    previous_total: round2(previousTotal),
    by_day: dayRows,
    by_hour: hourRows,
    best_day: bestDay,
    worst_day: worstDay,
    peak_hours: peakHours.map(({ hour, total }) => ({ hour, total })),
    dead_hours: deadHours.map(({ hour, total }) => ({ hour, total })),
    likely_closed_weekdays: likelyClosedWeekdays,
  };
}

async function aggregateCoupons(
  client: SupabaseClient,
  shopId: string,
  start: Date,
  end: Date
): Promise<WeeklyStatsPacket["coupons"]> {
  const { data: coupons, error: cErr } = await client
    .from("coupons")
    .select("id, name, type, is_active, used_count, created_at")
    .eq("shop_id", shopId);

  if (cErr) {
    logger.error("Weekly report: failed to fetch coupons:", cErr);
    return {
      active_count: 0,
      redemptions_this_week: 0,
      total_discount_given: 0,
      by_coupon: [],
      underperformers: [],
    };
  }

  const couponIds = (coupons ?? []).map((c) => c.id);
  let redemptions: any[] = [];
  const lifetimeCountByCoupon = new Map<string, number>();
  if (couponIds.length > 0) {
    const { data: reds, error: rErr } = await client
      .from("coupon_redemptions")
      .select("id, coupon_id, discount_applied, redeemed_at, status")
      .in("coupon_id", couponIds)
      .gte("redeemed_at", start.toISOString())
      .lt("redeemed_at", end.toISOString());

    if (rErr) {
      logger.error("Weekly report: failed to fetch redemptions:", rErr);
    } else {
      redemptions = reds ?? [];
    }

    const { data: lifetimeReds, error: lErr } = await client
      .from("coupon_redemptions")
      .select("coupon_id")
      .in("coupon_id", couponIds);
    if (lErr) {
      logger.error("Weekly report: failed to fetch lifetime redemptions:", lErr);
    } else {
      for (const r of lifetimeReds ?? []) {
        lifetimeCountByCoupon.set(
          r.coupon_id,
          (lifetimeCountByCoupon.get(r.coupon_id) ?? 0) + 1
        );
      }
    }
  }

  const redByCoupon = new Map<string, { count: number; discount: number }>();
  for (const r of redemptions) {
    const b = redByCoupon.get(r.coupon_id) ?? { count: 0, discount: 0 };
    b.count += 1;
    b.discount += Number(r.discount_applied ?? 0);
    redByCoupon.set(r.coupon_id, b);
  }

  const byCoupon = (coupons ?? []).map((c) => {
    const stats = redByCoupon.get(c.id) ?? { count: 0, discount: 0 };
    return {
      id: c.id,
      name: c.name,
      type: c.type,
      is_active: !!c.is_active,
      used_count: c.used_count ?? 0,
      redemptions_this_week: stats.count,
      discount_total_this_week: round2(stats.discount),
    };
  });

  const underperformers: Array<{ id: string; name: string; reason: string }> = [];
  for (const c of coupons ?? []) {
    if (!c.is_active) continue;
    const ageDays = (Date.now() - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < 14) continue;
    const lifetime = lifetimeCountByCoupon.get(c.id) ?? 0;
    if (lifetime === 0) {
      underperformers.push({
        id: c.id,
        name: c.name,
        reason: `active for ${Math.floor(ageDays)} days, zero redemptions`,
      });
    }
  }

  return {
    active_count: (coupons ?? []).filter((c) => c.is_active).length,
    redemptions_this_week: redemptions.length,
    total_discount_given: round2(
      redemptions.reduce((s, r) => s + Number(r.discount_applied ?? 0), 0)
    ),
    by_coupon: byCoupon,
    underperformers,
  };
}

async function aggregateCustomers(
  client: SupabaseClient,
  shopId: string,
  start: Date,
  end: Date
): Promise<WeeklyStatsPacket["customers"]> {
  const { data: txs, error: tErr } = await client
    .from("transactions")
    .select("app_user_id, total_amount, created_at, status")
    .eq("shop_id", shopId)
    .neq("status", "cancelled")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());

  if (tErr) {
    logger.error("Weekly report: failed to fetch customer txs:", tErr);
  }

  const weekTxs = (txs ?? []).filter((t) => t.app_user_id);
  const spentThisWeek = new Map<string, number>();
  const visitsThisWeek = new Map<string, number>();
  for (const t of weekTxs) {
    spentThisWeek.set(
      t.app_user_id,
      (spentThisWeek.get(t.app_user_id) ?? 0) + Number(t.total_amount)
    );
    visitsThisWeek.set(t.app_user_id, (visitsThisWeek.get(t.app_user_id) ?? 0) + 1);
  }
  const uniqueActive = spentThisWeek.size;

  const { data: loyaltyAccounts } = await client
    .from("customer_loyalty_accounts")
    .select("app_user_id, total_spent, last_visit_at, created_at, invoice_count")
    .eq("shop_id", shopId);

  const accountByUser = new Map<string, any>();
  for (const a of loyaltyAccounts ?? []) accountByUser.set(a.app_user_id, a);

  let newCount = 0;
  let returningCount = 0;
  for (const userId of spentThisWeek.keys()) {
    const acc = accountByUser.get(userId);
    if (acc && new Date(acc.created_at) >= start) newCount += 1;
    else returningCount += 1;
  }

  const userIds = Array.from(spentThisWeek.keys());
  const { data: users } = userIds.length
    ? await client.from("app_users").select("id, first_name, last_name").in("id", userIds)
    : { data: [] as any[] };
  const nameByUser = new Map<string, string | null>();
  for (const u of users ?? []) {
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || null;
    nameByUser.set(u.id, name);
  }

  const topSpenders = Array.from(spentThisWeek.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([userId, spent]) => ({
      app_user_id: userId,
      name: nameByUser.get(userId) ?? null,
      spent_this_week: round2(spent),
      total_spent: round2(Number(accountByUser.get(userId)?.total_spent ?? 0)),
    }));

  const sortedSpend = [...(loyaltyAccounts ?? [])]
    .map((a) => Number(a.total_spent ?? 0))
    .sort((a, b) => a - b);
  const median = sortedSpend.length
    ? sortedSpend[Math.floor(sortedSpend.length / 2)]
    : 0;

  const twentyOneDaysAgo = Date.now() - 21 * 24 * 60 * 60 * 1000;
  const atRiskRaw = (loyaltyAccounts ?? [])
    .filter((a) => {
      if (!a.last_visit_at) return false;
      if (Number(a.total_spent ?? 0) <= median) return false;
      return new Date(a.last_visit_at).getTime() < twentyOneDaysAgo;
    })
    .sort(
      (a, b) =>
        new Date(a.last_visit_at).getTime() - new Date(b.last_visit_at).getTime()
    )
    .slice(0, 10);

  const atRiskUserIds = atRiskRaw.map((a) => a.app_user_id);
  const { data: atRiskUsers } = atRiskUserIds.length
    ? await client
        .from("app_users")
        .select("id, first_name, last_name")
        .in("id", atRiskUserIds)
    : { data: [] as any[] };
  const atRiskNames = new Map<string, string | null>();
  for (const u of atRiskUsers ?? []) {
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || null;
    atRiskNames.set(u.id, name);
  }

  const atRisk = atRiskRaw.map((a) => ({
    app_user_id: a.app_user_id,
    name: atRiskNames.get(a.app_user_id) ?? null,
    last_visit_at: a.last_visit_at,
    days_since_visit: Math.floor(
      (Date.now() - new Date(a.last_visit_at).getTime()) / (1000 * 60 * 60 * 24)
    ),
    total_spent: round2(Number(a.total_spent ?? 0)),
  }));

  const totalReturningVisits = Array.from(visitsThisWeek.entries())
    .filter(([userId]) => {
      const acc = accountByUser.get(userId);
      return !(acc && new Date(acc.created_at) >= start);
    })
    .reduce((s, [, v]) => s + v, 0);
  const avgVisits = returningCount > 0 ? totalReturningVisits / returningCount : 0;

  return {
    new_count: newCount,
    returning_count: returningCount,
    unique_active_this_week: uniqueActive,
    avg_visits_per_returning: Math.round(avgVisits * 10) / 10,
    top_spenders: topSpenders,
    at_risk: atRisk,
  };
}

async function aggregateProducts(
  client: SupabaseClient,
  shopId: string,
  start: Date,
  end: Date
): Promise<WeeklyStatsPacket["products"]> {
  const { data: txs, error } = await client
    .from("transactions")
    .select("items, status")
    .eq("shop_id", shopId)
    .neq("status", "cancelled")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());

  if (error) {
    logger.error("Weekly report: failed to fetch product transactions:", error);
    return { top_sellers: [], slow_movers: [] };
  }

  const stats = new Map<string, { units: number; revenue: number }>();
  for (const t of txs ?? []) {
    if (!Array.isArray(t.items)) continue;
    for (const item of t.items as any[]) {
      const name = item?.name ?? item?.pos_article_id ?? item?.article_id;
      if (!name) continue;
      const qty = Number(item.quantity ?? 1);
      const revenue = Number(
        item.total_price ?? Number(item.unit_price ?? 0) * qty
      );
      const b = stats.get(name) ?? { units: 0, revenue: 0 };
      b.units += qty;
      b.revenue += revenue;
      stats.set(name, b);
    }
  }

  const all = Array.from(stats.entries()).map(([name, v]) => ({
    name,
    units: v.units,
    revenue: round2(v.revenue),
  }));
  const sorted = [...all].sort((a, b) => b.revenue - a.revenue);
  const topSellers = sorted.slice(0, 5);

  const { data: articles } = await client
    .from("articles")
    .select("name")
    .eq("shop_id", shopId);

  const soldNames = new Set(all.map((p) => p.name.toLowerCase()));
  const slowMovers = (articles ?? [])
    .filter((a) => !soldNames.has(a.name.toLowerCase()))
    .slice(0, 5)
    .map((a) => ({ name: a.name, units: 0, revenue: 0 }));

  return { top_sellers: topSellers, slow_movers: slowMovers };
}

async function aggregateLoyalty(
  client: SupabaseClient,
  shopId: string,
  start: Date,
  end: Date,
  programType: string | null
): Promise<WeeklyStatsPacket["loyalty"]> {
  const { data: txs } = await client
    .from("transactions")
    .select("loyalty_points_awarded, loyalty_stamps_awarded, status")
    .eq("shop_id", shopId)
    .neq("status", "cancelled")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());

  const pointsAwarded = (txs ?? []).reduce(
    (s, t) => s + (t.loyalty_points_awarded ?? 0),
    0
  );
  const stampsAwarded = (txs ?? []).reduce(
    (s, t) => s + (t.loyalty_stamps_awarded ?? 0),
    0
  );

  const { data: redemptions } = await client
    .from("coupon_redemptions")
    .select("points_deducted, redeemed_at, coupon_id, coupons!inner(shop_id)")
    .eq("coupons.shop_id", shopId)
    .gte("redeemed_at", start.toISOString())
    .lt("redeemed_at", end.toISOString());

  const pointsRedeemed = (redemptions ?? []).reduce(
    (s, r) => s + (r.points_deducted ?? 0),
    0
  );

  return {
    program_type: programType,
    points_awarded: pointsAwarded,
    points_redeemed: pointsRedeemed,
    stamps_awarded: stampsAwarded,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
