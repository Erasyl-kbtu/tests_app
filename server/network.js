import os from 'node:os';

/**
 * Returns all non-internal IPv4 addresses on the host, sorted so that
 * Wi-Fi / Windows Mobile Hotspot (192.168.137.1) / typical LAN IPs come first.
 */
export function getLocalAddresses() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      // Skip link-local 169.254.x.x
      if (addr.address.startsWith('169.254.')) continue;

      const lower = name.toLowerCase();
      let label = name;
      let priority = 50;

      if (addr.address === '192.168.137.1') {
        label = `Точка доступа Windows (${name})`;
        priority = 10;
      } else if (
        lower.includes('wi-fi') ||
        lower.includes('wifi') ||
        lower.includes('wlan') ||
        lower.includes('беспроводн')
      ) {
        label = `Wi-Fi (${name})`;
        priority = 5;
      } else if (
        addr.address.startsWith('192.168.56.') ||
        lower.includes('vethernet') ||
        lower.includes('wsl') ||
        lower.includes('docker') ||
        lower.includes('vmware') ||
        lower.includes('virtual')
      ) {
        label = `Виртуальный адаптер (${name})`;
        priority = 90;
      } else if (lower.includes('ethernet') || lower.includes('eth')) {
        label = `Кабель / Ethernet (${name})`;
        priority = 20;
      }

      candidates.push({
        address: addr.address,
        interfaceName: name,
        label,
        priority,
      });
    }
  }

  candidates.sort((a, b) => a.priority - b.priority);
  return candidates;
}
