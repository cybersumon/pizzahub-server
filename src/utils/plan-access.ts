export type RestaurantPlan = "free" | "premium" | "premium_plus";

export type PlanFeature =
  | "unlimited_menu"
  | "premium_details"
  | "premium_plus_details"
  | "table_reservation";

const LEVEL: Record<RestaurantPlan, number> = {
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

export function getEffectivePlan(restaurant: {
  plan?: unknown;
  stripeSubscriptionId?: unknown;
  stripeSubscriptionStatus?: unknown;
}): RestaurantPlan {
  const plan = restaurant.plan;

  if (plan !== "premium" && plan !== "premium_plus") {
    return "free";
  }

  // Paid features require a verified active Stripe subscription.
  if (
    typeof restaurant.stripeSubscriptionId !== "string" ||
    !restaurant.stripeSubscriptionId.startsWith("sub_") ||
    restaurant.stripeSubscriptionStatus !== "active"
  ) {
    return "free";
  }

  return plan;
}

export function canAccessFeature(
  plan: RestaurantPlan,
  feature: PlanFeature
): boolean {
  return LEVEL[plan] >= FEATURE_LEVEL[feature];
}
