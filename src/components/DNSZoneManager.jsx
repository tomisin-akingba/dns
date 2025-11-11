import React, { useState } from "react";
import { Edit, Save, X } from "lucide-react";

export default function DNSZoneManager() {
  const API_BASE = '/api/records';

  const [domain, setDomain] = useState("");
  const [showRecords, setShowRecords] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const INITIAL_RECORDS = {
    A: [{ name: "@", value: "192.0.2.1", ttl: "3600s" }],
    CNAME: [{ name: "www", value: "google.com", ttl: "3600s" }],
    MX: [{ name: "@", value: "mail.google.com", ttl: "3600s", priority: 10 }],
    TXT: [{ name: "@", value: "v=spf1 include:_spf.google.com ~all", ttl: "3600s" }],
    SPF: [{ name: "@", value: "v=spf1 ip4:192.0.2.0/24 -all", ttl: "3600s" }],
    "Other TXT records": [{ name: "@", value: "google-site-verification=abc123", ttl: "86400s" }],
  };

  const [records, setRecords] = useState(INITIAL_RECORDS);

  const [originalRecords, setOriginalRecords] = useState(INITIAL_RECORDS);



  const handleLookup = async () => {
    if (!domain) return;

    try {
      const res = await fetch(`${API_BASE}/${encodeURIComponent(domain)}`);
      if (!res.ok) {
        // treat non-OK as no data or error
        if (res.status === 404) {
          // no record found
          const createNew = confirm(
            `No records found for ${domain}. Do you want to create new records for this domain?`
          );
          if (createNew) {
            const emptyRecords = {
              A: [],
              AAAA: [],
              CNAME: [],
              MX: [],
              TXT: [],
              SPF: [],
              "Other TXT Records": [],
              "Other Records": [],
            };
            setRecords(emptyRecords);
            setIsEditing(true);
            setShowRecords(true);
          }
          return;
        }
        const text = await res.text();
        throw new Error(text || `Server returned ${res.status}`);
      }

      const data = await res.json();
      if (!data || Object.keys(data).length === 0) {
        const createNew = confirm(
          `No records found for ${domain}. Do you want to create new records for this domain?`
        );
        if (createNew) {
          const emptyRecords = {
            A: [],
            AAAA: [],
            CNAME: [],
            MX: [],
            TXT: [],
            SPF: [],
            "Other TXT Records": [],
            "Other Records": [],
          };
          setRecords(emptyRecords);
          setIsEditing(true);
          setShowRecords(true);
        }
        return;
      }

      setRecords(data);
      setShowRecords(true);
    } catch (err) {
      console.error('Lookup failed', err);
      alert('Lookup failed: ' + (err.message || err));
    }
};


  const handleRecordChange = (type, index, field, value) => {
    if (!isEditing) return;
    setRecords((prev) => {
      const updated = { ...prev };
      updated[type][index][field] = value;
      return updated;
    });
  };

  const handleEdit = () => {
    setIsEditing(true);
    setOriginalRecords(JSON.parse(JSON.stringify(records))); // deep copy
  };


  const handleSave = async () => {
    if (!domain.trim()) {
      alert('Please enter a domain before saving.');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/${encodeURIComponent(domain)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(records),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Server responded with ${res.status}`);
      }

      // update local saved copy
      setOriginalRecords(JSON.parse(JSON.stringify(records)));
      setIsEditing(false);
      alert('Records saved successfully.');
    } catch (err) {
      console.error('Failed to save records', err);
      alert('Failed to save records: ' + (err.message || err));
    }
  };

  const handleCancel = () => {
    setRecords(originalRecords);
    setIsEditing(false);
  };

  // Delete the currently shown domain (clears domain + hides results)
  const handleDeleteDomain = async () => {
    if (!domain) return;
    const ok = window.confirm(`Delete records for "${domain}"? This cannot be undone.`);
    if (!ok) return;

    try {
      const res = await fetch(`${API_BASE}/${encodeURIComponent(domain)}`, { method: 'DELETE' });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Server responded with ${res.status}`);
      }

      // Reset UI: clear domain, hide records, reset records to initial
      setDomain("");
      setShowRecords(false);
      setIsEditing(false);
      setRecords(INITIAL_RECORDS);
      setOriginalRecords(INITIAL_RECORDS);
      alert('Domain deleted successfully.');
    } catch (err) {
      console.error('Failed to delete domain', err);
      alert('Failed to delete domain: ' + (err.message || err));
    }
  };

  const addRecordRow = (type) => {
    setRecords((prev) => {
      const updated = { ...prev };
      const rows = Array.isArray(updated[type]) ? [...updated[type]] : [];
      rows.push({ name: "", value: "", ttl: "", priority: "" });
      updated[type] = rows;
      return updated;
    });
  };

  return (
    <div className="font-['Plus_Jakarta_Sans'] min-h-screen transition bg-gray-50 text-gray-900 flex flex-col">
      <div className="max-w-4xl mx-auto w-full p-8 flex-grow flex flex-col justify-center">
        {/* Header */}
        <div className="flex justify-center items-center mb-4">
          <h1 className="text-3xl font-semibold text-[#2664ec]">DNS Records Lookup</h1>
        </div>

        {/* Search Bar - Always visible */}
        <div className="flex justify-center mt-2 mb-4">
          <div className="flex gap-2 w-full max-w-md">
            <input
              type="text"
              placeholder="Enter a domain (e.g. google.com)"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && domain.trim()) {
                  handleLookup();
                }
              }}
              className="flex-1 h-8 text-sm px-3 py-1 rounded-md border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2664ec]"
            />
            <button
              onClick={handleLookup}
              className="h-8 px-3 text-sm bg-[#2664ec] hover:bg-[#1d4ed8] text-white rounded-md font-medium flex items-center justify-center"
            >
              {showRecords ? 'Search' : 'Lookup'}
            </button>
          </div>
        </div>

        {/* DNS Records Section */}
        {showRecords && (
          <div className="bg-white rounded-xl shadow-lg p-6 space-y-6 mt-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-[#2664ec]">
                DNS Records for {domain || "example.com"}
              </h2>
              {!isEditing ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleEdit}
                    className="flex items-center gap-1 px-4 py-2 bg-[#2664ec] hover:bg-[#1d4ed8] text-white rounded-lg font-medium"
                  >
                    <Edit size={16} /> Edit
                  </button>
                  <button
                    onClick={handleDeleteDomain}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
                  >
                    Delete Domain
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    className="flex items-center gap-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
                  >
                    <Save size={16} /> Save
                  </button>
                  <button
                    onClick={handleCancel}
                    className="flex items-center gap-1 px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-medium"
                  >
                    <X size={16} /> Cancel
                  </button>
                </div>
              )}
            </div>

            {Object.entries(records).map(([type, entries]) => (
              <div key={type}>
                <h3 className="text-lg font-semibold mb-2 text-[#2664ec]">{type} Records</h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-gray-300 text-left">
                        <th className="p-2">Name</th>
                        <th className="p-2">Value</th>
                        <th className="p-2">TTL</th>
                        <th className="p-2">Priority</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((record, idx) => (
                        <tr key={idx} className="border-b border-gray-200">
                          {["name", "value", "ttl", "priority"].map((field) => (
                            <td key={field} className="p-2">
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={record[field] || ""}
                                  onChange={(e) =>
                                    handleRecordChange(type, idx, field, e.target.value)
                                  }
                                  className="w-full bg-transparent border border-gray-300 rounded px-2 py-1"
                                />
                              ) : (
                                <span>{record[field] || "-"}</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {isEditing && (
                  <div className="mt-2">
                    <button
                      onClick={() => addRecordRow(type)}
                      className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-md"
                    >
                      + Add Row
                    </button>
                  </div>
                )}
                <hr className="border-gray-300 dark:border-gray-700 my-4" />
              </div>
            ))}

            {/* Other Records Dropdown */}
            <div>
              <label className="block mb-2 font-semibold text-[#2664ec]">Other Records</label>
              <select className="w-full p-2 border border-gray-300 rounded-lg bg-white">
                <option>Select record type</option>
                {[
                  "SRV",
                  "CAA",
                  "PTR",
                  "DNSKEY",
                  "NAPTR",
                  "DS",
                  "AFSDB",
                  "APL",
                  "CDNS KEY",
                  "CSYNC",
                  "DNAME",
                  "IPSECKEY",
                  "IXFR",
                  "KEY",
                  "NSEC",
                  "NSEC3",
                  "OPENPGPKEY",
                  "OPT",
                  "SIG",
                ]
                  .sort((a, b) => a.localeCompare(b))
                  .map((type) => (
                    <option key={type}>{type}</option>
                  ))}
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
