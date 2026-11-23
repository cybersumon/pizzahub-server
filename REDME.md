🍕 PizzaHub — Server
REST API backend for the PizzaHub restaurant marketplace and ordering application. Built with Express, TypeScript, MongoDB, Better Auth, and Stripe, it supports customer/vendor/admin access, restaurant approval, menu administration, orders, and Stripe-verified subscription entitlements.
> **Project type:** Full-stack assignment — backend repository  
> **Frontend:** Separate PizzaHub Client repository  
> **Default local API:** `http://localhost:7000`
Project Links
Resource	URL
Server GitHub repository	`ADD_SERVER_REPOSITORY_URL`
Client GitHub repository	`ADD_CLIENT_REPOSITORY_URL`
Client live site	`ADD_CLIENT_LIVE_URL`
Production API	`ADD_SERVER_BASE_URL`
Health check	`ADD_SERVER_BASE_URL/api/health`
Replace placeholders after deployment; never include secrets in the repository.
Key Features
Better Auth integration with session-based authentication.
Role-aware access control for customers, vendors, and administrators.
Restaurant onboarding and approval with owner-level record isolation.
Vendor restaurant profile management including branding data.
Menu CRUD and administrative review with plan-dependent menu limits.
Customer ordering and vendor order management through dedicated API routes.
Stripe subscription checkout for Premium and Premium+.
Verified Stripe webhook processing for subscription create, update, and delete events.
Stripe Customer Portal sessions for existing subscribers to manage billing and plan changes.
Subscription entitlement checks so client-side success pages do not directly activate paid features.
Cancellation scheduling data such as access end date and current billing period end, when synchronized from Stripe.
Admin subscription overview and transaction-event storage.
Technology Stack
Node.js and Express
TypeScript with ESM imports
MongoDB (native MongoDB driver)
Better Auth
Stripe Node SDK
Helmet security headers and CORS
Environment variables via `dotenv`
Local Setup
Prerequisites
Node.js (current LTS recommended)
npm
MongoDB Atlas or local MongoDB
Stripe sandbox/test account for paid-plan testing
Running frontend at `http://localhost:3000`
Installation
```bash
git clone ADD_SERVER_REPOSITORY_URL
cd pizzahub-server
npm install
```
Set up the server's `.env` based on the actual configuration in `src/config/database.ts`, `src/lib/auth.ts`, and your Stripe route files. Typical settings used by this project include:
```dotenv
PORT=7000
CLIENT_URL=http://localhost:3000

# Confirm database variable names in src/config/database.ts
MONGODB_URI=YOUR_MONGODB_CONNECTION_STRING
DB_NAME=pizzahub

# Confirm auth settings in src/lib/auth.ts
BETTER_AUTH_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET
BETTER_AUTH_URL=http://localhost:7000

# Stripe TEST values only for local development
STRIPE_SECRET_KEY=sk_test_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
STRIPE_PREMIUM_PRICE_ID=price_REPLACE_ME
STRIPE_PREMIUM_PLUS_PRICE_ID=price_REPLACE_ME
```
These are illustrative variable names/values. Check your actual source files and deployed environment for other required settings. Keep `.env` out of version control; use your host's environment-variable manager for deployment.
Start the backend:
```bash
npm run dev
```
Confirm it responds:
```bash
curl http://localhost:7000/api/health
```
Expected response shape:
```json
{
  "success": true,
  "message": "PizzaHub API is running"
}
```
TypeScript and production build
```bash
npx tsc --noEmit
npm run build
npm run start
```
Review `package.json` for the exact start command used by your deployment platform.
API Overview
Routes are registered in `src/server.ts`; permissions and request bodies are enforced by individual route handlers.
Endpoint / group	Purpose
`GET /api/health`	Service health check
`/api/auth/*`	Better Auth endpoints
`/api/restaurants`	Restaurant onboarding and owner profile
`/api/menu`	Menu browsing, vendor management, and review-related operations
`/api/orders`	Customer orders and vendor order handling
`/api/profile`	User profile
`/api/users`	User administration / lookup, subject to authorization
`/api/admin`	Administrative endpoints
`GET /api/subscriptions/my`	Authenticated vendor's effective plan and subscription information
`POST /api/subscriptions/checkout`	Start Stripe subscription checkout for an approved vendor
`POST /api/subscriptions/portal`	Create Stripe Customer Portal session for an existing subscriber
`POST /api/stripe/webhook`	Signed Stripe event intake; raw request body required
`/api/admin/subscriptions`	Admin subscription reporting
> Do not assume all methods are supported on every route group. See individual `src/routes/*.ts` files for exact HTTP methods, payloads, and guards.
Stripe Webhook Architecture
`src/server.ts` mounts the webhook before `express.json()` so that Stripe can verify the original raw payload:
```ts
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

app.use(express.json());
```
The imported handler must be the updated, canonical implementation. During development, two different functions named `stripeWebhook` existed under `src/routes/stripe-webhook.ts` and `src/controllers/stripe.controller.ts`. Verify `src/server.ts` imports the intended implementation; remove the unused duplicate only after testing.
Relevant Stripe events include:
`checkout.session.completed`
`customer.subscription.created`
`customer.subscription.updated`
`customer.subscription.deleted`
The webhook verifies the signature, retrieves subscription state from Stripe, checks restaurant ownership metadata, maps configured Stripe Price IDs to plans, and writes subscription information to MongoDB.
Test webhook locally
```bash
stripe listen --forward-to localhost:7000/api/stripe/webhook
```
Use the `whsec_...` value printed by the current Stripe CLI listener as `STRIPE_WEBHOOK_SECRET` in the local backend environment. Restart the backend after updating `.env`.
Do not use the CLI's temporary signing secret in the production deployment; configure a separate Stripe Dashboard webhook endpoint for production and use its own signing secret.
Plan Rules
Plan	Approved/active menu items	Premium details	Premium+ details	Table-reservation entitlement
Free	3	No	No	No
Premium	Unlimited	Yes	No	No
Premium+	Unlimited	Yes	Yes	Yes
Entitlements are calculated server-side in `src/utils/plan-access.ts` using the stored subscription state. A plan in a checkout URL or a frontend badge does not grant access.
Reservation entitlement does not mean full reservation-management UI is implemented. The frontend currently labels that management experience as Coming Soon.
Cancellation and Subscription Lifetime
Cancellation scheduled at period end does not immediately revoke paid benefits.
Store billing period end and cancellation details retrieved from Stripe (`stripeCancelAtPeriodEnd`, `stripeCurrentPeriodEnd`, `stripeCancelAt`, `stripeAccessEndsAt`) where supported by the canonical webhook.
After cancellation takes effect, the effective plan should return to Free and the Free menu limit should apply.
Handle webhook retries idempotently and verify final expiry behavior in test mode before launch.
Production caution: Delivery of `customer.subscription.deleted`, out-of-order events, and missed webhooks must be tested. Do not describe end-of-period Free restoration as verified until an end-to-end expiry test passes. Reconciliation against Stripe is recommended for recovery from missed events.
Security Checklist
[ ] Better Auth secret is long, random, and server-side only.
[ ] MongoDB URI, Stripe secret key, and webhook signing secret are never committed.
[ ] Production CORS uses the exact deployed frontend HTTPS origin.
[ ] Better Auth configured with production base URL and trusted origin(s).
[ ] Stripe webhook signature verification uses the raw request body.
[ ] Customer cannot call vendor write endpoints.
[ ] Vendor cannot edit another vendor's restaurant or menu.
[ ] Vendor cannot call admin-only endpoints.
[ ] Admin routes enforce backend authorization, not just frontend navigation.
[ ] Free-plan menu limit is enforced at the API/database logic layer.
[ ] Duplicate Stripe subscriptions are blocked or reconciled.
[ ] Rate limiting, input validation, logging, and error responses are reviewed for production.
Suggested Tests
Sign up as customer and confirm vendor/admin API access is blocked.
Create vendor account and restaurant; confirm admin approval is required.
Create/edit menu items and test Free-plan item limit.
Place an order and verify it appears in the correct vendor dashboard.
Complete Premium checkout using Stripe sandbox/test mode.
Upgrade Premium to Premium+ in Stripe Customer Portal.
Schedule cancellation; confirm MongoDB and `/api/subscriptions/my` expose the scheduled access end date.
Resume cancellation and verify the scheduled flag clears.
Test actual expiry/deletion and verify access reverts to Free.
Run TypeScript and production build successfully.
Directory Structure (Simplified)
```text
pizzahub-server/
├── src/
│   ├── config/database.ts
│   ├── controllers/stripe.controller.ts
│   ├── lib/auth.ts
│   ├── middleware/
│   ├── routes/
│   │   ├── subscription.routes.ts
│   │   ├── admin-subscription.routes.ts
│   │   ├── restaurant.routes.ts
│   │   ├── menu.routes.ts
│   │   └── order.routes.ts
│   ├── utils/plan-access.ts
│   └── server.ts
├── package.json
└── README.md
```
Deployment Notes
Deploy API to a provider that can run a persistent Node.js server (or adapt deliberately for the target runtime).
Configure environment variables securely, including the production `CLIENT_URL` and Better Auth settings.
Allow incoming HTTPS requests to the publicly accessible Stripe webhook URL: `https://YOUR_API_DOMAIN/api/stripe/webhook`.
Create the webhook endpoint in the correct Stripe account and mode; subscribe to the events listed above.
Confirm MongoDB network access from the deployed API and test `/api/health`.
Verify Stripe payment, billing portal, signature verification, cancellation display, and role permissions on the deployed environments.
Author
PizzaHub — Full-stack restaurant ordering assignment.