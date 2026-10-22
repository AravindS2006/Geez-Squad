import { loggedRoute } from '@/lib/request-log';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { db } from '@/lib/db';
import { shouldReconcileSubscription } from '@/lib/billing-policy';
import type { BillingSubscription } from '@prisma/client';
async function handlePOST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET)
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      await request.text(),
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }
  if (await db.webhookEvent.findUnique({ where: { id: event.id } }))
    return NextResponse.json({ ok: true });
  try {
    const subscriptionEvents = [
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ];
    let subscription: Stripe.Subscription | null = null;
    let observedBilling: BillingSubscription | null = null;
    const retrieve = async (
      id: string,
      customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
    ) => {
      const customerId = typeof customer === 'string' ? customer : customer?.id;
      if (!customerId) throw new Error('Billing customer is missing');
      // Capture the database version before the remote read. If another event
      // commits while Stripe responds, retry instead of overwriting its state.
      observedBilling = await db.billingSubscription.findUnique({ where: { customerId } });
      if (!observedBilling) throw new Error('Billing customer is not registered');
      return stripe.subscriptions.retrieve(id);
    };
    if (subscriptionEvents.includes(event.type)) {
      const source = event.data.object as Stripe.Subscription;
      subscription = await retrieve(source.id, source.customer);
    }
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const id =
        typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      if (id) subscription = await retrieve(id, session.customer);
    }
    await db.$transaction(async (tx) => {
      if (await tx.webhookEvent.findUnique({ where: { id: event.id } })) return;
      if (subscription) {
        const existing = observedBilling;
        if (!existing) throw new Error('Billing customer is not registered');
        if (
          shouldReconcileSubscription(existing.subscriptionId, subscription.id, subscription.status)
        ) {
          const changed = await tx.billingSubscription.updateMany({
            where: {
              id: existing.id,
              subscriptionId: existing.subscriptionId,
              updatedAt: existing.updatedAt,
            },
            data: { subscriptionId: subscription.id, status: subscription.status },
          });
          if (!changed.count) throw new Error('Concurrent billing update; retry required');
        }
      }
      await tx.webhookEvent.create({ data: { id: event.id } });
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: 'Webhook processing failed; retry required.' },
      { status: 500 },
    );
  }
}

export const POST = loggedRoute('/api/billing/webhook', handlePOST);
