import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { users } from '../../src/server/infrastructure/db/schema/index.js';
import { EncryptionKeyRing } from '../../src/server/infrastructure/encryption/key-ring.js';
import { AddressService } from '../../src/server/modules/addresses/address-service.js';
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from '../helpers/integration-database.js';

describe('recipient address defaults', () => {
  let fixture: IntegrationDatabase;
  beforeAll(async () => {
    fixture = await createIntegrationDatabase('addresses');
  });
  afterAll(async () => {
    await fixture?.cleanup();
  });

  it('keeps one default when the default address is demoted or removed', async () => {
    const [user] = await fixture.database.orm
      .insert(users)
      .values({ username: 'recipient', name: 'Recipient', bilibiliUid: '100001' })
      .returning();
    const context = { actorUserId: user!.id };
    const service = new AddressService(
      fixture.database,
      new EncryptionKeyRing({
        activeVersion: 1,
        keyRing: '1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      }),
    );
    const payload = {
      recipientName: '收件人',
      phone: '13800138000',
      countryRegion: '中国大陆',
      province: '上海市',
      city: '上海市',
      district: '浦东新区',
      detailedAddress: '测试路 1 号',
      postalCode: '',
      userNote: '',
    };
    const home = await service.create(user!.id, { label: '家', isDefault: true, payload }, context);
    const alternate = await service.create(
      user!.id,
      { label: '备用', isDefault: false, payload },
      context,
    );
    const defaults = async () =>
      (await service.list(user!.id)).filter((row) => row.isDefault).map((row) => row.id);
    await service.update(user!.id, home.id, { isDefault: false }, context);
    expect(await defaults()).toEqual([alternate.id]);
    await service.delete(user!.id, alternate.id, context);
    expect(await defaults()).toEqual([home.id]);
    await service.update(user!.id, home.id, { isDefault: false }, context);
    expect(await defaults()).toEqual([home.id]);
  });
});
