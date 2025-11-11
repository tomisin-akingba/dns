#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { isIP } from 'net';

const SYSTEM_ZONE_DIR = '/etc/bind/zone';
const LOCAL_ZONE_DIR = path.join(process.cwd(), 'zones');
const DNS_JSON = path.join(process.cwd(), 'dns_records.txt');

if (!fs.existsSync(DNS_JSON)) {
  console.error('dns_records.txt not found at', DNS_JSON);
  process.exit(1);
}

const dataRaw = fs.readFileSync(DNS_JSON, 'utf8');
let recordsByDomain;
try {
  recordsByDomain = JSON.parse(dataRaw);
} catch (e) {
  console.error('Failed to parse dns_records.txt as JSON:', e.message);
  process.exit(1);
}

if (!fs.existsSync(LOCAL_ZONE_DIR)) fs.mkdirSync(LOCAL_ZONE_DIR, { recursive: true });

const formatZoneFile = (domain, records) => {
  const lines = [];
  lines.push(`$TTL     86400    ; default TTL for this zone (1 day)`);
  lines.push(`$ORIGIN ${domain}.`);
  lines.push('');
  lines.push('; SOA Record');
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const serial = `${y}${m}${day}01`;
  lines.push(`@       3600     IN     SOA     dns1.nobus.io.  hostmaster.nobus.io. (`);
  lines.push(`                                        ${serial}`);
  lines.push(`                                        28800`);
  lines.push(`                                        7200`);
  lines.push(`                                        604800`);
  lines.push(`                                        3600`);
  lines.push('                                        )');
  lines.push('');

  if (records.A && records.A.length) {
    lines.push('; A Record');
    for (const r of records.A) {
      const name = r.name && r.name !== '@' ? r.name : '@';
      const ttl = r.ttl || '';
      lines.push(`${name}\t${ttl}\tIN\tA\t${r.value}`.replace('\t\t', '\t'));
    }
    lines.push('');
  }

  if (records.AAAA && records.AAAA.length) {
    lines.push('; AAAA Record');
    for (const r of records.AAAA) {
      const name = r.name && r.name !== '@' ? r.name : '@';
      const ttl = r.ttl || '';
      lines.push(`${name}\t${ttl}\tIN\tAAAA\t${r.value}`.replace('\t\t', '\t'));
    }
    lines.push('');
  }

  if (records.CNAME && records.CNAME.length) {
    lines.push('; CNAME Record');
    for (const r of records.CNAME) {
      const name = r.name || '';
      const ttl = r.ttl || '';
      lines.push(`${name}\t${ttl}\tIN\tCNAME\t${r.value}`.replace('\t\t', '\t'));
    }
    lines.push('');
  }

  if (records.MX && records.MX.length) {
    lines.push('; MX Record');
    for (const r of records.MX) {
      const name = r.name && r.name !== '@' ? r.name : '@';
      const ttl = r.ttl || '';
      const pr = r.priority !== undefined && r.priority !== '' ? r.priority : '10';
      lines.push(`${name}\t${ttl}\tIN\tMX\t${pr}\t${r.value}`.replace('\t\t', '\t'));
    }
    lines.push('');
  }

  const txtAll = [];
  if (records.TXT) txtAll.push(...records.TXT);
  if (records['Other TXT Records']) txtAll.push(...records['Other TXT Records']);
  if (records.SPF) txtAll.push(...records.SPF);
  if (txtAll.length) {
    lines.push('; TXT Record');
    for (const r of txtAll) {
      const name = r.name && r.name !== '@' ? r.name : '@';
      const ttl = r.ttl || '';
      const value = r.value && r.value.includes(' ') ? `"${r.value}"` : `"${r.value || ''}"`;
      lines.push(`${name}\t${ttl}\tIN\tTXT\t${value}`.replace('\t\t', '\t'));
    }
    lines.push('');
  }

  if (records['Other Records'] && records['Other Records'].length) {
    const ns = records['Other Records'].filter(r => r.type === 'NS');
    if (ns.length) {
      lines.push('; NS Record');
      for (const r of ns) {
        const name = r.name && r.name !== '@' ? r.name : '@';
        const ttl = r.ttl || '';
        lines.push(`${name}\t${ttl}\tIN\tNS\t${r.value}`.replace('\t\t', '\t'));
      }
      lines.push('');
    }
  }

  return lines.join('\n');
};

const sanitizeDomainForFilename = (domain) => {
  return String(domain).trim().toLowerCase().replace(/[^a-z0-9.-]/g, '-');
};

const validateRecords = (records) => {
  const errors = [];
  if (!records || typeof records !== 'object') {
    errors.push('Records must be an object');
    return errors;
  }
  const checkTTL = (ttl) => {
    if (ttl === undefined || ttl === null || ttl === '') return true;
    const n = parseInt(String(ttl).replace(/[^0-9]/g, ''), 10);
    return !Number.isNaN(n) && n >= 0;
  };

  if (Array.isArray(records.A)) {
    records.A.forEach((r, idx) => {
      if (!r || !r.value) { errors.push(`A[${idx}] missing value`); return; }
      if (isIP(r.value) !== 4) errors.push(`A[${idx}] value '${r.value}' is not a valid IPv4 address`);
      if (!checkTTL(r.ttl)) errors.push(`A[${idx}] has invalid ttl '${r.ttl}'`);
    });
  }

  if (Array.isArray(records.AAAA)) {
    records.AAAA.forEach((r, idx) => {
      if (!r || !r.value) { errors.push(`AAAA[${idx}] missing value`); return; }
      if (isIP(r.value) !== 6) errors.push(`AAAA[${idx}] value '${r.value}' is not a valid IPv6 address`);
      if (!checkTTL(r.ttl)) errors.push(`AAAA[${idx}] has invalid ttl '${r.ttl}'`);
    });
  }

  if (Array.isArray(records.MX)) {
    records.MX.forEach((r, idx) => {
      if (!r || !r.value) { errors.push(`MX[${idx}] missing value`); return; }
      const pr = r.priority;
      if (pr !== undefined && pr !== null && pr !== '') {
        const n = Number(pr);
        if (!Number.isInteger(n) || n < 0) errors.push(`MX[${idx}] has invalid priority '${pr}'`);
      }
      if (!checkTTL(r.ttl)) errors.push(`MX[${idx}] has invalid ttl '${r.ttl}'`);
    });
  }

  return errors;
};

const writeZone = (domain, records) => {
  const filename = `db.${sanitizeDomainForFilename(domain)}`;
  const content = formatZoneFile(domain, records);
  try {
    if (!fs.existsSync(SYSTEM_ZONE_DIR)) fs.mkdirSync(SYSTEM_ZONE_DIR, { recursive: true });
    const p = path.join(SYSTEM_ZONE_DIR, filename);
    fs.writeFileSync(p, content, 'utf8');
    try { fs.writeFileSync(p + '.json', JSON.stringify(records, null, 2), 'utf8'); } catch(e){}
    return { path: p, writtenTo: 'system' };
  } catch (err) {
    const p = path.join(LOCAL_ZONE_DIR, filename);
    fs.writeFileSync(p, content, 'utf8');
    fs.writeFileSync(p + '.json', JSON.stringify(records, null, 2), 'utf8');
    return { path: p, writtenTo: 'local' };
  }
};

const domains = Object.keys(recordsByDomain);
if (!domains.length) {
  console.log('No domains found in dns_records.txt');
  process.exit(0);
}

const created = [];
for (const domain of domains) {
  const rec = recordsByDomain[domain];
  try {
    const res = writeZone(domain, rec);
    created.push(res);
    console.log('Wrote', domain, '->', res.path, res.writtenTo);
  } catch (e) {
    console.error('Failed to write zone for', domain, e.message);
  }
}

console.log('\nSummary:');
console.log(created);
