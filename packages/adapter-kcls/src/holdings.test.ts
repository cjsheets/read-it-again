import { describe, expect, it } from 'vitest';
import { parseHoldings } from './holdings.js';

describe('KCLS holdings parser', () => {
  it('extracts aggregate and branch holdings without modeling copies', () => {
    expect(
      parseHoldings(
        `<holdings><counts><available>2</available><count>4</count></counts><volumes><volume><branch><shortname>BEL</shortname><name>Bellevue</name></branch><call_number>E NORTH</call_number><available>1</available></volume><volume><branch><shortname>RED</shortname><name>Redmond</name></branch><call_number>E NORTH</call_number><available>1</available></volume></volumes></holdings>`,
      ),
    ).toEqual({
      systemAvailable: 2,
      systemTotal: 4,
      branches: [
        { shortName: 'BEL', name: 'Bellevue', available: 1, callNumbers: ['E NORTH'] },
        { shortName: 'RED', name: 'Redmond', available: 1, callNumbers: ['E NORTH'] },
      ],
    });
  });

  it('reads the attribute-based KCLS aggregate shape', () => {
    expect(
      parseHoldings(
        `<holdings><counts><count type="public" available="3" count="12" unshadow="12"/></counts><volumes/></holdings>`,
      ),
    ).toMatchObject({ systemAvailable: 3, systemTotal: 12 });
  });
});
