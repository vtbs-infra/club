import type { Clock } from '../../infrastructure/clock/clock.js';
import type { DatabaseService } from '../../infrastructure/db/database.js';
import type { GiftOrderStatus } from '../../infrastructure/db/schema/index.js';
import type { EncryptionKeyRing } from '../../infrastructure/encryption/key-ring.js';
import type { AddressService } from '../addresses/address-service.js';
import type { RequestAuditContext } from '../audit/audit-service.js';
import type { TrackingProvider } from '../fulfillment/tracking-provider.js';
import { GiftClaimService } from './claim-service.js';
import { GiftFulfillmentExportService } from './fulfillment-export-service.js';
import { GiftFulfillmentService } from './fulfillment-service.js';
import { GiftOrderQueryService } from './order-query-service.js';

type ClaimValue = boolean | string;

/**
 * Wires the order workflow services together. HTTP and runtimes depend on this
 * facade so construction stays in one place while each transaction remains
 * owned by its domain service.
 */
export class GiftOrderService {
  public readonly claims: GiftClaimService;
  private readonly exporter: GiftFulfillmentExportService;
  public readonly fulfillment: GiftFulfillmentService;
  public readonly queries: GiftOrderQueryService;

  public constructor(
    database: DatabaseService,
    encryption: EncryptionKeyRing,
    addresses: AddressService,
    trackingProvider: TrackingProvider | null,
    clock: Clock,
  ) {
    this.claims = new GiftClaimService(database, encryption, addresses, clock);
    this.exporter = new GiftFulfillmentExportService(database, encryption, clock);
    this.fulfillment = new GiftFulfillmentService(database, trackingProvider, clock);
    this.queries = new GiftOrderQueryService(database, encryption);
  }

  public expireClaimable() {
    return this.claims.expireClaimable();
  }

  public listForUser(userId: string, limit?: number) {
    return this.queries.listForUser(userId, limit);
  }

  public getForUser(userId: string, orderId: string) {
    return this.queries.getForUser(userId, orderId);
  }

  public async submit(
    userId: string,
    orderId: string,
    input: {
      readonly addressId: string;
      readonly expectedVersion: number;
      readonly options: Readonly<Record<string, ClaimValue>>;
    },
    context: RequestAuditContext,
  ) {
    await this.claims.submit(userId, orderId, input, context);
    return this.queries.getForUser(userId, orderId);
  }

  public listForCreator(creatorId: string, status?: GiftOrderStatus) {
    return this.queries.listForCreator(creatorId, status);
  }

  public getForCreator(creatorId: string, orderId: string, context: RequestAuditContext) {
    return this.queries.getForCreator(creatorId, orderId, context);
  }

  public exportFulfillment(
    creator: { readonly displayName: string; readonly id: string; readonly timezone: string },
    releaseId: string,
    context: RequestAuditContext,
  ) {
    return this.exporter.exportRelease(creator, releaseId, context);
  }

  public complete(creatorId: string, orderId: string, context: RequestAuditContext) {
    return this.fulfillment.complete(creatorId, orderId, context);
  }

  public cancel(creatorId: string, orderId: string, reason: string, context: RequestAuditContext) {
    return this.fulfillment.cancel(creatorId, orderId, reason, context);
  }

  public async ship(
    creatorId: string,
    orderId: string,
    input: {
      readonly carrierCode: string;
      readonly carrierName: string;
      readonly trackingNumber: string;
      readonly trackingUrl?: string | null;
    },
    context: RequestAuditContext,
  ) {
    await this.fulfillment.ship(creatorId, orderId, input, context);
    return this.queries.getForCreator(creatorId, orderId, context);
  }
}
