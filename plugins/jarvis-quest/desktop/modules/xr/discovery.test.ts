import { describe, expect, it } from 'vitest';
import { buildDiscoveryPayload, ipv4Broadcast, isPrivateIPv4, privateBroadcastTargets } from './discovery';

describe('özel IPv4 süzme', () => {
  it('özel aralıklar kabul, genel/ipv6 ret', () => {
    for (const ip of ['10.0.0.1', '10.255.1.1', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.1.1']) {
      expect(isPrivateIPv4(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.167.0.1', '1.2.3.4', 'fe80::1', 'not-ip']) {
      expect(isPrivateIPv4(ip)).toBe(false);
    }
  });
});

describe('yayın adresi', () => {
  it('adres | ~maske', () => {
    expect(ipv4Broadcast('192.168.1.50', '255.255.255.0')).toBe('192.168.1.255');
    expect(ipv4Broadcast('10.1.2.3', '255.0.0.0')).toBe('10.255.255.255');
    expect(ipv4Broadcast('172.16.5.6', '255.255.0.0')).toBe('172.16.255.255');
    expect(ipv4Broadcast('10.1.2.3', 'bozuk')).toBe('255.255.255.255');
  });
});

describe('keşif yükü', () => {
  it('doğru JSON alanları', () => {
    const payload = JSON.parse(buildDiscoveryPayload({ name: 'Fuber PC', fp: 'abc', pairing: true }).toString('utf8'));
    expect(payload).toEqual({ fuberxr: 1, name: 'Fuber PC', p: 47852, f: 'abc', pairing: true });
  });
});

describe('arayüz süzme çalışır', () => {
  it('sahte arayüz listesinden yalnız özel IPv4 seçilir', () => {
    const fake = {
      eth0: [
        { address: '192.168.1.10', netmask: '255.255.255.0', family: 'IPv4', internal: false, mac: '', cidr: null },
        { address: 'fe80::1', netmask: 'ffff::', family: 'IPv6', internal: false, mac: '', cidr: null },
      ],
      lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true, mac: '', cidr: null }],
      wan: [{ address: '8.8.8.8', netmask: '255.255.255.0', family: 'IPv4', internal: false, mac: '', cidr: null }],
    } as unknown as NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]>;
    const targets = privateBroadcastTargets(fake);
    expect(targets).toEqual([{ address: '192.168.1.10', broadcast: '192.168.1.255' }]);
  });
});
