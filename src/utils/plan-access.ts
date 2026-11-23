export type RestaurantPlan = "free" | "premium" | "premium_plus";

export type PlanFeature =
  | "unlimited_menu"
  | "premium_details"
  | "premium_plus_details"
  | "table_reservation";

interface RestaurantSubscription {
  plan?: unknown;
  stripeSubscriptionId?: unknown;
  stripeSubscriptionStatus?: unknown;
  stripeCancelAtPeriodEnd?: unknown;
  stripeAccessEndsAt?: unknown;
}

const PLAN_LEVEL: Record<RestaurantPlan, number> = {
  free: 0,
  premium: 1,
  premium_plus: 2,
};

const FEATURE_LEVEL: Record<PlanFeature, number> = {
  unlimited_menu: 1,
  premium_details: 1,
  premium_plus_details: 2,
  table_reservation: 2,
};

export function normalizePlan(value: unknown): RestaurantPlan {
  if (value === "premium") return "premium";
  if (value === "premium_plus") return "premium_plus";
  return "free";
}

export function canAccessFeature(plan: RestaurantPlan, feature: PlanFeature): boolean {
  return PLAN_LEVEL[plan] >= FEATURE_LEVEL[feature];
}

export function getEffectivePlan<T extends object>(restaurant: T): RestaurantPlan {
  const subscription = restaurant as RestaurantSubscription;
  const plan = normalizePlan(subscription.plan);
  if (plan === "free") return "free";

  // Stripe-verified active subscriptions are required for paid features.
  if (
    typeof subscription.stripeSubscriptionId !== "string" ||
    subscription.stripeSubscriptionId.length === 0 ||
    subscription.stripeSubscriptionStatus !== "active"
  ) {
    return "free";
  }

  // Prevent access beyond a known scheduled cancellation date if a webhook
  // arrives late. Normal active subscriptions remain unaffected.
  if (subscription.stripeCancelAtPeriodEnd === true) {
    const value = subscription.stripeAccessEndsAt;
    const expiry = value instanceof Date
      ? value.getTime()
      : typeof value === "string"
        ? Date.parse(value)
        : NaN;
    if (Number.isFinite(expiry) && Date.now() >= expiry) return "free";
  }

  return plan;
}
