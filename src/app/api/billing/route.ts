import { loggedRoute } from '@/lib/request-log';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { z } from 'zod';
import { db } from '@/lib/db';
import { ApiError, requireUser, readJson, safeError, rateLimit } from '@/lib/security';
async function handlePOST(request: Request) {
  try {
    const user = await requireUser();
    const { action } = z
      .object({ action: z.enum(['checkout', 'portal']) })
      .parse(await readJson(request));
    await rateLimit(user.id, 'billing', 5);
    if (user.role !== 'coach')
      throw new ApiError(403, 'Studio subscriptions are managed by coaches.');
    if (
      !process.env.STRIPE_SECRET_KEY ||
      !process.env.STRIPE_PRICE_ID ||
      !process.env.STRIPE_WEBHOOK_SECRET
    )
      throw new ApiError(503, 'Subscriptions are not configured.');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    let billing = await db.billingSubscription.findUnique({ where: { userId: user.id } });
    if (!billing) {
      const customer = await stripe.customers.create(
        { email: user.email, name: user.name, metadata: { userId: user.id } },
        { idempotencyKey: `customer-${user.id}` },
      );
      billing = await db.billingSubscription.upsert({
        where: { userId: user.id },
        create: { userId: user.id, customerId: customer.id },
        update: {},
      });
    }
    const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
    if (action === 'portal') {
      const session = await stripe.billingPortal.sessions.create({
        customer: billing.customerId,
        return_url: `${origin}/app?view=settings`,
      });
      return NextResponse.json({ url: session.url });
    }
    if (['active', 'trialing', 'past_due'].includes(billing.status))
      throw new ApiError(409, 'Manage your existing subscription in the billing portal.');
    const subscriptions = await stripe.subscriptions.list({
      customer: billing.customerId,
      limit: 10,
      status: 'all',
    });
    if (
      subscriptions.data.some((s) =>
        ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status),
      )
    )
      throw new ApiError(
        409,
        'An existing subscription needs to be managed in the billing portal.',
      );
    const existingSessions = await stripe.checkout.sessions.list({
      customer: billing.customerId,
      limit: 10,
    });
    const open = existingSessions.data.find(
      (s) => s.status === 'open' && s.mode === 'subscription' && s.url,
    );
    if (open) return NextResponse.json({ url: open.url });
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: billing.customerId,
        line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
        success_url: `${origin}/app?view=settings`,
        cancel_url: `${origin}/app?view=settings`,
        client_reference_id: user.id,
        subscription_data: { metadata: { userId: user.id } },
      },
      { idempotencyKey: `checkout-${user.id}-${Math.floor(Date.now() / 600000)}` },
    );
    return NextResponse.json({ url: session.url });
  } catch (error) {
    return safeError(error);
  }
}

export const POST = loggedRoute('/api/billing', handlePOST);
