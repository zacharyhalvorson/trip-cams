# 511 API key registration checklist

The live endpoint probe confirmed that 24 registered camera APIs are
key-gated: 23 IBI 511 platforms respond `{"Message":"Invalid Key"}` and
Ohio's OHGO responds `401 API key required.` Registering keys for them is
the single biggest coverage unlock (~40% of North America).

Registration can't be automated — each site needs an account signup with
email verification and terms acceptance. It's a few minutes per site.

## How to register (IBI 511 platforms)

Every IBI 511 site follows the same flow:

1. Open `https://<host>/developers/doc` (linked as "Developers" in the
   site footer, sometimes under "Resources").
2. Create an account / log in, then request a developer API key from the
   account or developers page. Keys are usually issued instantly.
3. The API is then `https://<host>/api/v2/get/cameras?format=json&key=<KEY>`.

| Region | Site | Developer docs |
|---|---|---|
| SK | hotline.gov.sk.ca | https://hotline.gov.sk.ca/developers/doc |
| MB | www.manitoba511.ca | https://www.manitoba511.ca/developers/doc |
| NB | 511.gnb.ca | https://511.gnb.ca/developers/doc |
| NS | 511.novascotia.ca | https://511.novascotia.ca/developers/doc |
| PE | 511.gov.pe.ca | https://511.gov.pe.ca/developers/doc |
| NL | 511nl.ca | https://511nl.ca/developers/doc |
| YT | 511yukon.ca | https://511yukon.ca/developers/doc |
| NY | 511ny.org | https://511ny.org/developers/doc |
| PA | 511pa.com | https://511pa.com/developers/doc |
| CT | ctroads.com | https://ctroads.com/developers/doc |
| GA | 511ga.org | https://511ga.org/developers/doc |
| FL | fl511.com | https://fl511.com/developers/doc |
| WI | 511wi.gov | https://511wi.gov/developers/help |
| LA | 511la.org | https://511la.org/developers/doc |
| AZ | az511.com | https://www.az511.com/developers/doc |
| ID | 511.idaho.gov | https://511.idaho.gov/developers/doc |
| AK | 511.alaska.gov | https://511.alaska.gov/developers/doc |
| UT | udottraffic.utah.gov | https://udottraffic.utah.gov/developers/doc |
| NV | nvroads.com | https://nvroads.com/developers/doc |
| VT/NH/ME | www.newengland511.org | https://www.newengland511.org/developers/doc |
| NC | drivenc.gov | https://drivenc.gov/developers/doc |

(One registration covers VT, NH, and ME — they share newengland511.org.)

## Ohio (OHGO)

Register at https://publicapi.ohgo.com/docs/resources — the key is sent
as an `api-key` request header, not a query param.

## Where the keys go

Keys stay server-side. Two places, same JSON shape:

```json
{
  "511ny.org": "YOUR-511NY-KEY",
  "hotline.gov.sk.ca": "YOUR-SK-KEY",
  "publicapi.ohgo.com": { "header": "api-key", "key": "YOUR-OHGO-KEY" }
}
```

A plain string value means "append as the `key` query parameter" (the
IBI convention); an object with `header` sends it as a request header.

1. **Cloudflare Worker** (serves the web app — keys are injected by the
   proxy so they never ship in client JS):

   ```bash
   cd cors-proxy
   npx wrangler secret put API_KEYS   # paste the JSON
   npx wrangler deploy
   ```

2. **GitHub Actions secret** `TRIPCAMS_API_KEYS` (same JSON) — lets the
   daily endpoint-health probe verify the keyed regions.

## After adding keys

1. Run the endpoint-health workflow manually (Actions → Camera Endpoint
   Health → Run workflow) and confirm the keyed regions report `OK`.
2. Move them from `speculative` to `expectOk` in
   `tests/endpoint-expectations.json` so CI guards them from then on.

Note: because key-gated hosts reject direct browser fetches, the app's
per-host transport memory automatically learns to route them through the
Worker — no client changes are needed.
