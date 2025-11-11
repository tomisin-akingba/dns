import express from "express";
import fs from "fs";
import cors from "cors";
import bodyParser from "body-parser";
import path from "path";
import { isIP } from 'net';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 5000;

// Resolve paths relative to this file so the server behaves the same regardless of cwd
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Zone directories: system BIND directory and local fallback
const SYSTEM_ZONE_DIR = '/etc/bind/zone';
const LOCAL_ZONE_DIR = path.join(__dirname, 'zones');
const BUILD_DIR = path.join(__dirname, 'dist');

app.use(cors());
app.use(bodyParser.json());

// Serve built frontend if available (assumes you ran the frontend build into `dist`)
if (fs.existsSync(BUILD_DIR)) {
  app.use(express.static(BUILD_DIR));
}

// Ensure local zone dir exists
if (!fs.existsSync(LOCAL_ZONE_DIR)) {
  fs.mkdirSync(LOCAL_ZONE_DIR, { recursive: true });
}

// Build a BIND-style zone file from the provided records object.
// SOA is fixed to use nobus.ng (dns1.nobus.io. / hostmaster.nobus.io.) as requested.
const formatZoneFile = (domain, records) => {
  const lines = [];
  lines.push(`$TTL     86400    ; default TTL for this zone (1 day)`);
  lines.push(`$ORIGIN ${domain}.`);
  lines.push('');
  // SOA Record - fixed to nobus.ng naming per request
  lines.push('; SOA Record');
  // generate a YYYYMMDDnn style serial (nn = 01)
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

  // A records
  if (Array.isArray(records.A) && records.A.length) {
    lines.push('; A Record');
    for (const r of records.A) {
      const name = r.name && r.name !== '@' ? r.name : '@';
      const ttl = r.ttl || '';
      lines.push(`${name}\t${ttl}\tIN\tA\t${r.value}`.replace('\t\t', '\t'));
    }
    lines.push('');
  }

  // AAAA
  if (Array.isArray(records.AAAA) && records.AAAA.length) {
    lines.push('; AAAA Record');
    for (const r of records.AAAA) {
      const name = r.name && r.name !== '@' ? r.name : '@';
      const ttl = r.ttl || '';
      lines.push(`${name}\t${ttl}\tIN\tAAAA\t${r.value}`.replace('\t\t', '\t'));
    }
    lines.push('');
  }

  // CNAME
  if (Array.isArray(records.CNAME) && records.CNAME.length) {
    lines.push('; CNAME Record');
    for (const r of records.CNAME) {
      const name = r.name || '';
      const ttl = r.ttl || '';
      lines.push(`${name}\t${ttl}\tIN\tCNAME\t${r.value}`.replace('\t\t', '\t'));
    }
    lines.push('');
  }

  // MX
  if (Array.isArray(records.MX) && records.MX.length) {
    lines.push('; MX Record');
    for (const r of records.MX) {
      const name = r.name && r.name !== '@' ? r.name : '@';
      const ttl = r.ttl || '';
      const pr = r.priority !== undefined && r.priority !== '' ? r.priority : '10';
      lines.push(`${name}\t${ttl}\tIN\tMX\t${pr}\t${r.value}`.replace('\t\t', '\t'));
    }
    lines.push('');
  }

  // TXT & SPF (both are TXT records in zone files)
  const txtAll = [];
  if (Array.isArray(records.TXT)) txtAll.push(...records.TXT);
  if (Array.isArray(records['Other TXT Records'])) txtAll.push(...records['Other TXT Records']);
  if (Array.isArray(records.SPF)) txtAll.push(...records.SPF);
  if (txtAll.length) {
    lines.push('; TXT Record');
    for (const r of txtAll) {
      const name = r.name && r.name !== '@' ? r.name : '@';
      const ttl = r.ttl || '';
      // wrap long text fields in parentheses if needed
      const value = r.value && r.value.includes(' ') ? `"${r.value}"` : `"${r.value || ''}"`;
      lines.push(`${name}\t${ttl}\tIN\tTXT\t${value}`.replace('\t\t', '\t'));
    }
    lines.push('');
  }

  // NS records (if provided in Other Records)
  if (Array.isArray(records['Other Records'])) {
    const ns = records['Other Records'].filter((r) => r.type === 'NS');
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

  // Add an SOA-suggested NS/MX if none exist? We'll keep it minimal and return the lines.
  return lines.join('\n');
};

// Try to write zone file into SYSTEM_ZONE_DIR, otherwise write into LOCAL_ZONE_DIR
const sanitizeDomainForFilename = (domain) => {
  // allow a-z, A-Z, 0-9, dot and hyphen; replace other chars with '-'
  return String(domain).trim().toLowerCase().replace(/[^a-z0-9.-]/g, '-');
};

const writeZoneFile = (domain, records) => {
  const validation = validateRecords(records);
  console.log('validation result for', domain, validation);
  if (validation && validation.length) {
    throw new Error('Validation failed: ' + validation.join('; '));
  }
  const safeDomain = sanitizeDomainForFilename(domain);
  const zoneFilename = `db.${safeDomain}`;
  const zoneContent = formatZoneFile(domain, records);

  // first try system dir
  try {
    if (!fs.existsSync(SYSTEM_ZONE_DIR)) {
      // attempt to create it (may fail due to permission)
      fs.mkdirSync(SYSTEM_ZONE_DIR, { recursive: true });
    }
    const systemPath = path.join(SYSTEM_ZONE_DIR, zoneFilename);
    fs.writeFileSync(systemPath, zoneContent, { encoding: 'utf8' });
    // also write JSON copy next to it for API consumption
    try {
      fs.writeFileSync(systemPath + '.json', JSON.stringify(records, null, 2), 'utf8');
    } catch (e) {
      // ignore JSON write failures to system dir
    }
    return { path: systemPath, writtenTo: 'system' };
  } catch (err) {
    // fallback to local
    const localPath = path.join(LOCAL_ZONE_DIR, zoneFilename);
    fs.writeFileSync(localPath, zoneContent, { encoding: 'utf8' });
    fs.writeFileSync(localPath + '.json', JSON.stringify(records, null, 2), 'utf8');
    return { path: localPath, writtenTo: 'local' };
  }
};

// Validate record structure and basic semantics
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

  // A records must be IPv4
  if (Array.isArray(records.A)) {
    records.A.forEach((r, idx) => {
      if (!r || !r.value) {
        errors.push(`A[${idx}] missing value`);
        return;
      }
      if (isIP(r.value) !== 4) errors.push(`A[${idx}] value '${r.value}' is not a valid IPv4 address`);
      if (!checkTTL(r.ttl)) errors.push(`A[${idx}] has invalid ttl '${r.ttl}'`);
    });
  }

  // AAAA records must be IPv6
  if (Array.isArray(records.AAAA)) {
    records.AAAA.forEach((r, idx) => {
      if (!r || !r.value) {
        errors.push(`AAAA[${idx}] missing value`);
        return;
      }
      if (isIP(r.value) !== 6) errors.push(`AAAA[${idx}] value '${r.value}' is not a valid IPv6 address`);
      if (!checkTTL(r.ttl)) errors.push(`AAAA[${idx}] has invalid ttl '${r.ttl}'`);
    });
  }

  // MX records must have numeric priority
  if (Array.isArray(records.MX)) {
    records.MX.forEach((r, idx) => {
      if (!r || !r.value) {
        errors.push(`MX[${idx}] missing value`);
        return;
      }
      const pr = r.priority;
      if (pr !== undefined && pr !== null && pr !== '') {
        const n = Number(pr);
        if (!Number.isInteger(n) || n < 0) errors.push(`MX[${idx}] has invalid priority '${pr}'`);
      }
      if (!checkTTL(r.ttl)) errors.push(`MX[${idx}] has invalid ttl '${r.ttl}'`);
    });
  }

  // CNAME values should look like hostnames (basic check)
  if (Array.isArray(records.CNAME)) {
    const hostnameRE = /^[a-zA-Z0-9.-]+$/;
    records.CNAME.forEach((r, idx) => {
      if (!r || !r.value) {
        errors.push(`CNAME[${idx}] missing value`);
        return;
      }
      if (!hostnameRE.test(r.value)) errors.push(`CNAME[${idx}] value '${r.value}' looks invalid`);
      if (!checkTTL(r.ttl)) errors.push(`CNAME[${idx}] has invalid ttl '${r.ttl}'`);
    });
  }

  // TXT/SPF: ttl check only
  const txtBuckets = ['TXT', 'SPF', 'Other TXT Records'];
  for (const key of txtBuckets) {
    if (Array.isArray(records[key])) {
      records[key].forEach((r, idx) => {
        if (!r || r.value === undefined) {
          errors.push(`${key}[${idx}] missing value`);
          return;
        }
        if (!checkTTL(r.ttl)) errors.push(`${key}[${idx}] has invalid ttl '${r.ttl}'`);
      });
    }
  }

  return errors;
};

// Load records from zone JSON files found in system or local zone dirs.
const loadRecords = () => {
  const result = {};

  // prefer system dir JSON files
  const tryDirs = [SYSTEM_ZONE_DIR, LOCAL_ZONE_DIR];
  for (const dir of tryDirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const full = path.join(dir, f);
        try {
          const raw = fs.readFileSync(full, 'utf8');
          const parsed = JSON.parse(raw);
          // file name like db.example.com.json -> extract domain
          const domain = f.replace(/^db\./, '').replace(/\.json$/, '');
          result[domain] = parsed;
        } catch (e) {
          // skip malformed
        }
      }
    } catch (e) {
      // ignore
    }
  }

  return result;
};

// 🟢 Get all records
app.get("/api/records", (req, res) => {
  const data = loadRecords();
  res.json(data);
});

// 🔵 Get a specific domain
app.get("/api/records/:domain", (req, res) => {
  const data = loadRecords();
  const domain = req.params.domain;
  res.json(data[domain] || {});
});

// 🟡 Save (Create/Update) domain records
app.post("/api/records/:domain", (req, res) => {
  const domain = req.params.domain;
  const errors = validateRecords(req.body);
  if (errors && errors.length) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }
  try {
    const result = writeZoneFile(domain, req.body);
    res.status(200).json({ message: "Saved successfully", path: result.path, writtenTo: result.writtenTo });
  } catch (err) {
    console.error('Failed to write zone file', err);
    res.status(500).json({ error: 'Failed to write zone file', details: err.message });
  }
});

// Accept PUT as well for updates (frontend may use PUT)
app.put("/api/records/:domain", (req, res) => {
  const domain = req.params.domain;
  const errors = validateRecords(req.body);
  if (errors && errors.length) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }
  try {
    const result = writeZoneFile(domain, req.body);
    res.status(200).json({ message: "Saved successfully", path: result.path, writtenTo: result.writtenTo });
  } catch (err) {
    console.error('Failed to write zone file', err);
    res.status(500).json({ error: 'Failed to write zone file', details: err.message });
  }
});

// 🔴 Delete a domain
app.delete("/api/records/:domain", (req, res) => {
  const domain = req.params.domain;
  const zoneFilename = `db.${domain}`;
  const targets = [
    path.join(SYSTEM_ZONE_DIR, zoneFilename),
    path.join(SYSTEM_ZONE_DIR, zoneFilename + '.json'),
    path.join(LOCAL_ZONE_DIR, zoneFilename),
    path.join(LOCAL_ZONE_DIR, zoneFilename + '.json'),
  ];

  const removed = [];
  for (const t of targets) {
    try {
      if (fs.existsSync(t)) {
        fs.unlinkSync(t);
        removed.push(t);
      }
    } catch (e) {
      // ignore individual failures
    }
  }

  res.json({ message: "Deleted successfully", removed });
});

// Fallback: serve index.html for any non-API GET request (SPA routing)
app.use((req, res) => {
  // Only handle GET requests
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
  // don't intercept API routes
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  
  const indexPath = path.join(BUILD_DIR, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(404).send('Not found');
});

app.listen(PORT, () =>
  console.log(`✅ Server running on http://localhost:${PORT}`)
);