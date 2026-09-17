const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name}`, extra ?? '');
  }
}

async function req(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function login(email: string, password: string): Promise<string | null> {
  const r = await req('POST', '/api/auth/login', null, { email, password });
  check(`login ${email}`, r.status === 200, r.json);
  const tok = (r.json as any)?.access_token ?? (r.json as any)?.accessToken ?? null;
  return tok;
}

async function main(): Promise<void> {
  const admin = await login('admin@example.com', 'admin12345');
  const staff = await login('staff1@example.com', 'staff12345');
  if (!admin || !staff) throw new Error('login failed');

  // -- admin list --
  const list = await req('GET', '/api/projects?page=1&page_size=50', admin);
  check('GET /api/projects 200', list.status === 200, list.json);
  const body = list.json as any;
  check('list has rows + pagination', Array.isArray(body?.rows) && typeof body?.total === 'number');
  const rows: any[] = body?.rows ?? [];
  check('every row carries vendors[]', rows.length > 0 && rows.every((r) => Array.isArray(r.vendors)));
  check('total_lines integer', typeof body?.total_lines === 'number');
  const first = rows[0];
  check('row exposes customer_id', typeof first?.customer_id === 'string');

  // -- sort via pic_id (SORTABLE_COLUMNS join path) --
  const sorted = await req('GET', '/api/projects?page=1&page_size=50&sort_by=pic_id&sort_dir=asc', admin);
  check('sort_by=pic_id 200', sorted.status === 200, sorted.json);

  // -- staff list (RBAC filter) --
  const staffList = await req('GET', '/api/projects?page=1&page_size=50', staff);
  check('staff GET /api/projects 200', staffList.status === 200, staffList.json);
  const staffRows: any[] = (staffList.json as any)?.rows ?? [];
  check('staff list restricted to assignment', staffRows.every((r) => r.staff_assigned?.email === 'staff1@example.com') && staffRows.length > 0);

  // -- create artifacts: customer, vendor, project --
  const newCust = await req('POST', '/api/customers', admin, { name: 'Smoke Customer' });
  check('POST /api/customers 201', newCust.status === 201, newCust.json);
  const custId = (newCust.json as any)?.id;

  const newVendor = await req('POST', '/api/vendors', admin, { name: 'Smoke Vendor' });
  check('POST /api/vendors 201', newVendor.status === 201, newVendor.json);
  const vendorId = (newVendor.json as any)?.id;

  const today = new Date().toISOString().slice(0, 10);
  const newProj = await req('POST', '/api/projects', admin, {
    project_name: 'Smoke Project',
    customer_id: custId,
    service_or_goods: 'service',
    current_stage: 'on_progress',
    vendors: [
      { vendor_id: vendorId, vendor_type: 'service', project_sent_date: today, vendor_price: 5555 },
      { vendor_type: 'service', project_sent_date: today },
    ],
  });
  check('POST /api/projects with vendors[] 201', newProj.status === 201, newProj.json);
  const proj: any = newProj.json;
  check('created project echoes 2 vendor lines', Array.isArray(proj?.vendors) && proj.vendors.length === 2, proj?.vendors);

  const line1 = proj.vendors.find((v: any) => v.vendor_id === vendorId)!;
  const line2 = proj.vendors.find((v: any) => !v.vendor_id)!;
  check('line1 keeps vendor_id + values', line1?.vendor_id === vendorId && line1?.vendor_price === 5555);

  // -- vendor line CRUD --
  const lineUpdate = await req('PATCH', `/api/projects/${proj.id}/vendors/${line1.id}`, admin, { vendor_price: 8888, vendor_type: 'goods' });
  check('PATCH vendor line 200', lineUpdate.status === 200, lineUpdate.json);
  const afterUpdate = await req('GET', `/api/projects/${proj.id}`, admin);
  const updLine = (afterUpdate.json as any)?.vendors?.find((v: any) => v.id === line1.id);
  check('vendor line persisted update', updLine?.vendor_price === 8888 && updLine?.vendor_type === 'goods', updLine);

  const missing = await req('PATCH', `/api/projects/${proj.id}/vendors/${line1.id}`, admin, { vendor_id: 'deadbeef' });
  check('vendor line rejects unknown vendor_id (400/422)', [400, 422].includes(missing.status), missing.json);

  const lineDelete = await req('DELETE', `/api/projects/${proj.id}/vendors/${line2.id}`, admin);
  check('DELETE vendor line 200', lineDelete.status === 200, lineDelete.json);
  const afterDel = await req('GET', `/api/projects/${proj.id}`, admin);
  check('vendor line count after delete = 1', (afterDel.json as any)?.vendors?.length === 1, afterDel.json);

  // -- staff editing project still works (immediate apply) --
  const staffPatch = await req('PATCH', `/api/projects/${proj.id}`, staff, { ...(first?.staff_assigned_id === 'dead' ? {} : {}), issues: 'smoke note' });
  check('STAFF PATCH project (authorized only)', staffPatch.status === 403, staffPatch.json); // staff not assigned to this project

  const adminPatch = await req('PATCH', `/api/projects/${proj.id}`, admin, { current_stage: 'finish' });
  check('ADMIN PATCH project 200', adminPatch.status === 200, adminPatch.json);
  check('ADMIN PATCH applied', (adminPatch.json as any)?.current_stage === 'finish');

  // -- dashboard aggregates over vendor/priority --
  for (const col of ['priority', 'vendor_type', 'customer_name', 'current_stage']) {
    const agg = await req('GET', `/api/dashboard/chart-data?column=${col}`, admin);
    check(`chart-data column=${col} 200`, agg.status === 200, agg.json);
  }
  const drill = await req('GET', `/api/dashboard/chart-data?column=vendor_type&selected_id=${vendorId}`, admin);
  check('drill-down vendor_type&selected_id 200', drill.status === 200, drill.json);

  // -- delete artifacts + usageCount notice --
  const custDel = await req('DELETE', `/api/customers/${custId}`, admin);
  check('DELETE customer returns usageCount', custDel.status === 200 && typeof (custDel.json as any)?.usageCount === 'number', custDel.json);
  const vendDel = await req('DELETE', `/api/vendors/${vendorId}`, admin);
  check('DELETE vendor returns usageCount', vendDel.status === 200 && typeof (vendDel.json as any)?.usageCount === 'number', vendDel.json);
  const projDel = await req('DELETE', `/api/projects/${proj.id}`, admin);
  check('DELETE project 200', [200, 204].includes(projDel.status), projDel.json);
  const gone = await req('GET', `/api/projects?search=Smoke%20Project`, admin);
  check('project really deleted', (gone.json as any)?.total === 0, gone.json);

  console.log(failures === 0 ? '\nSMOKE OK' : `\nSMOKE FAILURES: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SMOKE ERROR', err);
  process.exit(1);
});