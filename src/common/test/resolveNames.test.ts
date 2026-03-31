import { describe, it, expect } from 'vitest';
import {
    resolveRing,
    resolveRegion,
    RING_LONG_NAME_MAP,
    REGION_LONG_NAME_MAP,
} from '../resolveNames.js';

describe('resolveRing', () => {
    it('resolves short names to full names', () => {
        expect(resolveRing('tst')).toBe('test');
        expect(resolveRing('stg')).toBe('staging');
        expect(resolveRing('prd')).toBe('production');
    });

    it('passes through full names unchanged', () => {
        expect(resolveRing('test')).toBe('test');
        expect(resolveRing('staging')).toBe('staging');
        expect(resolveRing('production')).toBe('production');
    });

    it('is case-insensitive', () => {
        expect(resolveRing('TST')).toBe('test');
        expect(resolveRing('Stg')).toBe('staging');
        expect(resolveRing('PRODUCTION')).toBe('production');
    });

    it('passes through unknown values as-is', () => {
        expect(resolveRing('unknown')).toBe('unknown');
        expect(resolveRing('dev')).toBe('dev');
    });
});

describe('resolveRegion', () => {
    it('resolves short names to full names (Azure)', () => {
        expect(resolveRegion('krc')).toBe('koreacentral');
        expect(resolveRegion('eas')).toBe('eastasia');
        expect(resolveRegion('eus')).toBe('eastus');
        expect(resolveRegion('wus')).toBe('westus');
        expect(resolveRegion('krs')).toBe('koreasouth');
    });

    it('resolves short names to full names (Alibaba)', () => {
        expect(resolveRegion('hzh')).toBe('cn-hangzhou');
        expect(resolveRegion('sha')).toBe('cn-shanghai');
        expect(resolveRegion('bej')).toBe('cn-beijing');
        expect(resolveRegion('sg1')).toBe('ap-southeast-1');
    });

    it('passes through full names unchanged', () => {
        expect(resolveRegion('koreacentral')).toBe('koreacentral');
        expect(resolveRegion('eastasia')).toBe('eastasia');
        expect(resolveRegion('cn-hangzhou')).toBe('cn-hangzhou');
    });

    it('is case-insensitive', () => {
        expect(resolveRegion('KRC')).toBe('koreacentral');
        expect(resolveRegion('EAS')).toBe('eastasia');
    });

    it('passes through unknown values as-is', () => {
        expect(resolveRegion('us-west-2')).toBe('us-west-2');
        expect(resolveRegion('unknown')).toBe('unknown');
    });
});

describe('reverse maps', () => {
    it('RING_LONG_NAME_MAP covers all short names', () => {
        expect(RING_LONG_NAME_MAP).toEqual({
            'tst': 'test',
            'stg': 'staging',
            'prd': 'production',
        });
    });

    it('REGION_LONG_NAME_MAP covers all short names', () => {
        expect(REGION_LONG_NAME_MAP).toEqual({
            'eus': 'eastus',
            'wus': 'westus',
            'eas': 'eastasia',
            'krc': 'koreacentral',
            'krs': 'koreasouth',
            'hzh': 'cn-hangzhou',
            'sha': 'cn-shanghai',
            'bej': 'cn-beijing',
            'sg1': 'ap-southeast-1',
        });
    });
});
