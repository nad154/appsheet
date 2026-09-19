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
  const usersList = await req('GET', '/api/projects/users', admin);
  const usersArr: any[] = (usersList.json as any) ?? [];
  const staffUser = usersArr.find((u) => u.role === 'STAFF');
  const adminUser = usersArr.find((u) => u.role === 'SUPER_ADMIN');
  check('assignable users expose role', !!staffUser && !!adminUser, usersArr);

  const staffList = await req('GET', '/api/projects?page=1&page_size=50', staff);
  check('staff GET /api/projects 200', staffList.status === 200, staffList.json);
  const staffRows: any[] = (staffList.json as any)?.rows ?? [];
  check('staff list restricted to assignment', staffRows.length > 0 && staffUser?.id && staffRows.every((r) => r.staff_assigned_id === staffUser.id));

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
      { vendor_id: vendorId, vendor_type: 'service', project_sent_date: today, vendor_price: 5555, sort_order: 0 },
      { vendor_id: vendorId, vendor_type: 'service', project_sent_date: today, sort_order: 1 },
    ],
  });
  check('POST /api/projects with vendors[] 201', newProj.status === 201, newProj.json);
  const projId: string = (newProj.json as any)?.id;
  check('created project returns id', typeof projId === 'string' && projId.length > 0, newProj.json);

  // The create response is just { id } — re-fetch the full row via GET /:id.
  const createdRow = await req('GET', `/api/projects/${projId}`, admin);
  check('GET /api/projects/:id 200', createdRow.status === 200, createdRow.json);
  const proj: any = createdRow.json;
  check('created project echoes 2 vendor lines', Array.isArray(proj?.vendors) && proj.vendors.length === 2, proj?.vendors);

  const line1 = proj.vendors.find((v: any) => v.sort_order === 0)!;
  const line2 = proj.vendors.find((v: any) => v.sort_order === 1)!;
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
  const staffPatch = await req('PATCH', `/api/projects/${proj.id}`, staff, { update_progress: 'smoke note', issues: 'should not persist' });
  check('STAFF PATCH project (authorized only)', staffPatch.status === 403, staffPatch.json); // staff not assigned to this project

  const adminPatch = await req('PATCH', `/api/projects/${proj.id}`, admin, { current_stage: 'finish' });
  check('ADMIN PATCH project 200', adminPatch.status === 200, adminPatch.json);
  const patchedRow = await req('GET', `/api/projects/${proj.id}`, admin);
  check('ADMIN PATCH applied', (patchedRow.json as any)?.current_stage === 'finish', patchedRow.json);

  // -- issues: SUPER_ADMIN-only add + history --
  const staffIssuesGet = await req('GET', `/api/projects/${proj.id}/issues`, staff);
  check('STAFF GET issues 403', staffIssuesGet.status === 403, staffIssuesGet.json);

  const staffIssuesPost = await req('POST', `/api/projects/${proj.id}/issues`, staff, { issue_text: 'nope' });
  check('STAFF POST issues 403', staffIssuesPost.status === 403, staffIssuesPost.json);

  const emptyHistory = await req('GET', `/api/projects/${proj.id}/issues`, admin);
  check('ADMIN GET issues 200 (empty)', emptyHistory.status === 200 && (emptyHistory.json as any)?.entries?.length === 0, emptyHistory.json);

  const badAssignee = await req('POST', `/api/projects/${proj.id}/issues`, admin, { issue_text: 'x', assignee_id: adminUser?.id });
  check('issue rejects non-STAFF assignee (400)', badAssignee.status === 400, badAssignee.json);

  const badDate = await req('POST', `/api/projects/${proj.id}/issues`, admin, { issue_text: 'x', issue_date: 'not-a-date' });
  check('issue rejects bad date (400)', badDate.status === 400, badDate.json);

  const missingText = await req('POST', `/api/projects/${proj.id}/issues`, admin, {});
  check('issue requires issue_text (400)', missingText.status === 400, missingText.json);

  const addIssue = await req('POST', `/api/projects/${proj.id}/issues`, admin, {
    issue_text: 'Smoke issue',
    issue_date: today,
    assignee_id: staffUser?.id,
  });
  check('ADMIN POST issues 201', addIssue.status === 201, addIssue.json);

  const history = await req('GET', `/api/projects/${proj.id}/issues`, admin);
  const entries: any[] = (history.json as any)?.entries ?? [];
  check('issue appears in history', history.status === 200 && entries.length === 1 && entries[0]?.issue_text === 'Smoke issue', entries);
  check('issue carries assignee + date', entries[0]?.assignee_name === staffUser?.name && entries[0]?.issue_date === today, entries[0]);

  // Second issue with no assignee (default None); the grid should surface the
  // LATEST text, with the older text only available in admin history.
  const addIssue2 = await req('POST', `/api/projects/${proj.id}/issues`, admin, { issue_text: 'Second issue' });
  check('ADMIN POST issues (no assignee) 201', addIssue2.status === 201, addIssue2.json);

  const listAfter = await req('GET', '/api/projects?page=1&page_size=500', admin);
  const listed = (listAfter.json as any)?.rows?.find((r: any) => r.id === proj.id);
  check('grid row exposes latest issue text + meta', listed?.issues === 'Second issue' && !!listed?.latest_issue_date && listed?.latest_issue_assignee === null, listed);

  const history2 = await req('GET', `/api/projects/${proj.id}/issues`, admin);
  check('history keeps all past issues (2 newest-first)', (history2.json as any)?.entries?.[0]?.issue_text === 'Second issue' && (history2.json as any)?.entries?.[1]?.issue_text === 'Smoke issue', history2.json);

  // -- dashboard aggregates over vendor/priority --
  for (const col of ['priority', 'vendor_type', 'market_segment', 'current_stage']) {
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
  const goneList = await req('GET', '/api/projects?page=1&page_size=500', admin);
  const goneRows: any[] = (goneList.json as any)?.rows ?? [];
  check('project really deleted', !goneRows.some((r) => r.id === proj.id) && goneList.status === 200, goneRows);

  console.log(failures === 0 ? '\nSMOKE OK' : `\nSMOKE FAILURES: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SMOKE ERROR', err);
  process.exit(1);
});