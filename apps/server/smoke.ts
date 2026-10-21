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
  const staffSub = staff
    ? (JSON.parse(Buffer.from(staff.split('.')[1], 'base64').toString()) as any).sub
    : null;
  check('staff list restricted to assignment', staffRows.length > 0 && !!staffSub && staffRows.every((r) => r.staff_assigned_id === staffSub));

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

  // -- CSV import (plan_csv_import §10) --
  // Pre-clean leftovers from earlier runs so counts are deterministic.
  async function listProjectsAll(): Promise<any[]> {
    const all: any[] = [];
    for (let page = 1; page <= 50; page++) {
      const r = await req('GET', `/api/projects?page=${page}&page_size=500`, admin);
      const j = r.json as any;
      if (!Array.isArray(j?.rows) || j.rows.length === 0) break;
      all.push(...j.rows);
      if (page >= (j.total_pages ?? 1)) break;
    }
    return all;
  }
  for (const p of (await listProjectsAll()).filter((r: any) => String(r.project_name).startsWith('Smoke Import'))) {
    await req('DELETE', `/api/projects/${p.id}`, admin);
  }
  const preCustomers = ((await req('GET', '/api/customers', admin)).json as any[]) ?? [];
  for (const c of preCustomers.filter((c: any) => c.name.startsWith('Smoke Import'))) {
    await req('DELETE', `/api/customers/${c.id}`, admin);
  }
  const preVendors = ((await req('GET', '/api/vendors', admin)).json as any[]) ?? [];
  for (const v of preVendors.filter((v: any) => v.name.startsWith('Smoke Import'))) {
    await req('DELETE', `/api/vendors/${v.id}`, admin);
  }

  // Soft-deleted leftovers from earlier runs keep their label forever (the API
  // has no hard delete), so use a run-unique segment label.
  const SEGMENT_LABEL = `Smoke Import Segment ${Date.now()}`;
  const projectKeys = {
    project_name: '', folder_name: '', customer_name: '', market_segment: '',
    service_or_goods: '', customer_price: null as string | number | null, staff_assigned: '',
    current_stage: '', pic: '', date_customer_received_doc1: '',
    vendor_name: '', vendor_type: '', vendor_revenue: null as string | number | null,
    project_sent_date: '', approval_date: '',
  };
  const importRows = [
    {
      ...projectKeys,
      project_name: 'Smoke Import Alpha', folder_name: 'SMK-IMP-001',
      customer_name: 'Smoke Import Customer', market_segment: SEGMENT_LABEL,
      service_or_goods: 'service', customer_price: '1.500.000.000',
      staff_assigned: 'admin@example.com', current_stage: 'On Progress',
      vendor_name: 'Smoke Import Vendor A', vendor_type: 'service',
      vendor_revenue: '1.000.000', project_sent_date: '01/08/2026', approval_date: '10/08/2026',
    },
    {
      ...projectKeys,
      vendor_name: 'Smoke Import Vendor B', vendor_type: 'goods', project_sent_date: '05/08/2026',
    },
    {
      ...projectKeys,
      project_name: 'Smoke Import Beta', folder_name: 'SMK-IMP-002',
      customer_name: 'Smoke Import Customer', vendor_name: 'Smoke Import Vendor A',
      project_sent_date: '01/08/2026',
    },
  ];
  const importBody = {
    options: { continueBlankRows: true, dateFormat: 'DD/MM/YYYY', onDuplicate: 'skip' },
    rows: importRows,
  };

  const staffImport = await req('POST', '/api/import/projects/preview', staff, importBody);
  check('STAFF preview 403', staffImport.status === 403, staffImport.json);

  const unknownKey = await req('POST', '/api/import/projects/preview', admin, {
    options: {},
    rows: [{ project_name: 'x', bogus_key: 'y' }],
  });
  check('unknown field key 400', unknownKey.status === 400 && JSON.stringify(unknownKey.json).includes('bogus_key'), unknownKey.json);

  const totalBefore = ((await req('GET', '/api/projects?page=1&page_size=1', admin)).json as any)?.total;
  const preview = await req('POST', '/api/import/projects/preview', admin, importBody);
  const pv = preview.json as any;
  check('preview 200', preview.status === 200, preview.json);
  check('preview counts projects/lines', pv?.summary?.projects === 2 && pv?.summary?.vendor_lines === 3, pv?.summary);
  check('preview counts new entities',
    JSON.stringify(pv?.summary?.new_customers) === JSON.stringify(['Smoke Import Customer'])
    && JSON.stringify(pv?.summary?.new_vendors) === JSON.stringify(['Smoke Import Vendor A', 'Smoke Import Vendor B'])
    && JSON.stringify(pv?.summary?.new_segments) === JSON.stringify([SEGMENT_LABEL]), pv?.summary);
  check('preview clean', pv?.summary?.errors === 0 && pv?.summary?.skipped_duplicates === 0, pv);
  check('preview nests 2 lines on first sample', pv?.sample?.[0]?.lines?.length === 2, pv?.sample?.[0]);
  const totalAfterPreview = ((await req('GET', '/api/projects?page=1&page_size=1', admin)).json as any)?.total;
  check('preview writes nothing', totalBefore === totalAfterPreview, { totalBefore, totalAfterPreview });

  const commit = await req('POST', '/api/import/projects/commit', admin, importBody);
  const cm = commit.json as any;
  check('commit 200 with counts', commit.status === 200
    && cm?.created_projects === 2 && cm?.created_vendor_lines === 3
    && cm?.created_customers === 1 && cm?.created_vendors === 2
    && cm?.created_segments === 1, commit.json);

  const afterCommit = await listProjectsAll();
  const alpha = afterCommit.find((r: any) => r.project_name === 'Smoke Import Alpha');
  const beta = afterCommit.find((r: any) => r.project_name === 'Smoke Import Beta');
  check('imported projects in grid', !!alpha && !!beta);
  check('grid joins customer + segment + sales',
    alpha?.customer_name === 'Smoke Import Customer'
    && alpha?.market_segment === SEGMENT_LABEL
    && alpha?.folder_name === 'SMK-IMP-001'
    && alpha?.staff_assigned_name === adminUser?.name, alpha);
  check('grid-style rows grouped into one project with 2 lines',
    Array.isArray(alpha?.vendors) && alpha.vendors.length === 2
    && alpha.vendors[0]?.project_sent_date?.startsWith('2026-08-01')
    && alpha.vendors[0]?.approval_date?.startsWith('2026-08-10')
    && alpha.vendors[1]?.vendor_name === 'Smoke Import Vendor B', alpha?.vendors);
  check('vendorless-fill beta has 1 line', Array.isArray(beta?.vendors) && beta.vendors.length === 1, beta?.vendors);

  const segmentsList = ((await req('GET', '/api/settings/market-segments', admin)).json as any[]) ?? [];
  const smokeSegment = segmentsList.find((s: any) => s.label === SEGMENT_LABEL);
  check('segment created active', !!smokeSegment && smokeSegment.is_active === true, smokeSegment);

  const previewAgain = await req('POST', '/api/import/projects/preview', admin, importBody);
  check('re-preview reports duplicates skipped', (previewAgain.json as any)?.summary?.skipped_duplicates === 2, previewAgain.json);

  const commitAgain = await req('POST', '/api/import/projects/commit', admin, importBody);
  check('re-commit with skip creates nothing', commitAgain.status === 200
    && (commitAgain.json as any)?.created_projects === 0
    && (commitAgain.json as any)?.skipped_duplicates === 2, commitAgain.json);

  const commitReject = await req('POST', '/api/import/projects/commit', admin, {
    ...importBody,
    options: { ...importBody.options, onDuplicate: 'reject' },
  });
  check('onDuplicate=reject rejects with 400', commitReject.status === 400
    && JSON.stringify(commitReject.json).includes('already exists'), commitReject.json);

  // One bad date: commit 400, and the valid rows in the same payload must NOT
  // exist afterwards (nothing is written).
  const badBody = {
    options: importBody.options,
    rows: [
      { ...projectKeys, project_name: 'Smoke Import Gamma', folder_name: 'SMK-IMP-G',
        vendor_name: 'Smoke Import Vendor A', project_sent_date: '31/02/2026' },
    ],
  };
  const badPreview = await req('POST', '/api/import/projects/preview', admin, badBody);
  const badPv = badPreview.json as any;
  check('bad date reported with label', badPv?.summary?.errors === 1
    && badPv?.errors?.[0]?.message.includes('FPT Sent Date')
    && badPv?.errors?.[0]?.message.includes('is not a valid date'), badPv?.errors);
  const badCommit = await req('POST', '/api/import/projects/commit', admin, badBody);
  check('bad date commit 400', badCommit.status === 400, badCommit.json);
  const gammaList = await listProjectsAll();
  check('bad date commit wrote nothing', !gammaList.some((r: any) => r.project_name === 'Smoke Import Gamma'));

  // Amount above the DuckDB INTEGER limit is a validation error, not a 500.
  const bigBody = {
    options: importBody.options,
    rows: [{ ...projectKeys, project_name: 'Smoke Import Huge', folder_name: 'SMK-IMP-H', customer_price: '3000000000' }],
  };
  const bigPreview = await req('POST', '/api/import/projects/preview', admin, bigBody);
  check('amount above INTEGER limit reported', bigPreview.status === 200
    && (bigPreview.json as any)?.summary?.errors === 1
    && (bigPreview.json as any)?.errors?.[0]?.message.includes('maximum the database can store'), bigPreview.json);
  const bigCommit = await req('POST', '/api/import/projects/commit', admin, bigBody);
  check('amount above INTEGER limit commit 400 (not 500)', bigCommit.status === 400, bigCommit.json);

  // Missing sales user: error, users are never created by import.
  const ghostBody = {
    options: importBody.options,
    rows: [{ ...projectKeys, project_name: 'Smoke Import Ghost', folder_name: 'SMK-IMP-XX', staff_assigned: 'ghost@example.com' }],
  };
  const ghostPreview = await req('POST', '/api/import/projects/preview', admin, ghostBody);
  check('unknown sales user reported', (ghostPreview.json as any)?.summary?.errors === 1
    && (ghostPreview.json as any)?.errors?.[0]?.message.includes('Sales Name'), ghostPreview.json);

  // No vendor column: projects are created without vendor lines + info note.
  const noVendorBody = {
    options: importBody.options,
    rows: [{ project_name: 'Smoke Import Solo', folder_name: 'SMK-IMP-S', customer_name: 'Smoke Import Customer' }],
  };
  const noVendorPreview = await req('POST', '/api/import/projects/preview', admin, noVendorBody);
  check('vendorless import shows note + 0 lines', (noVendorPreview.json as any)?.summary?.vendor_lines === 0
    && ((noVendorPreview.json as any)?.notes ?? []).some((n: string) => n.includes('No vendor column mapped')), noVendorPreview.json);
  const noVendorCommit = await req('POST', '/api/import/projects/commit', admin, noVendorBody);
  check('vendorless commit creates project', noVendorCommit.status === 200
    && (noVendorCommit.json as any)?.created_projects === 1, noVendorCommit.json);

  // -- saved import mapping (plan §7) --
  const mapPut = await req('PUT', '/api/me/preferences/import-mapping', admin, {
    mapping: { 'Tanggal Kirim FPT': 'project_sent_date', '#': null },
    version: 1,
  });
  check('PUT import-mapping 200', mapPut.status === 200, mapPut.json);
  const mapGet = await req('GET', '/api/me/preferences/import-mapping', admin);
  check('GET import-mapping returns saved mapping', mapGet.status === 200
    && JSON.stringify((mapGet.json as any)?.mapping) === JSON.stringify({ 'Tanggal Kirim FPT': 'project_sent_date', '#': null }), mapGet.json);
  const mapBad = await req('PUT', '/api/me/preferences/import-mapping', admin, {
    mapping: { X: 'not_a_field' },
    version: 1,
  });
  check('PUT import-mapping rejects unknown field 400', mapBad.status === 400
    && JSON.stringify(mapBad.json).includes('Unknown import field: not_a_field'), mapBad.json);
  const mapStaff = await req('GET', '/api/me/preferences/import-mapping', staff);
  check('import-mapping is per-user (staff sees own, empty)', mapStaff.status === 200
    && Object.keys((mapStaff.json as any)?.mapping ?? {}).length === 0, mapStaff.json);
  const mapDel = await req('DELETE', '/api/me/preferences/import-mapping', admin);
  const mapGet2 = await req('GET', '/api/me/preferences/import-mapping', admin);
  check('DELETE import-mapping resets', mapDel.status === 200 && mapGet2.status === 200
    && Object.keys((mapGet2.json as any)?.mapping ?? {}).length === 0, mapGet2.json);

  // -- import cleanup --
  for (const p of (await listProjectsAll()).filter((r: any) => String(r.project_name).startsWith('Smoke Import'))) {
    const d = await req('DELETE', `/api/projects/${p.id}`, admin);
    check(`cleanup project ${p.project_name}`, [200, 204].includes(d.status), d.json);
  }
  for (const c of (((await req('GET', '/api/customers', admin)).json as any[]) ?? []).filter((c: any) => c.name.startsWith('Smoke Import'))) {
    await req('DELETE', `/api/customers/${c.id}`, admin);
  }
  for (const v of (((await req('GET', '/api/vendors', admin)).json as any[]) ?? []).filter((v: any) => v.name.startsWith('Smoke Import'))) {
    await req('DELETE', `/api/vendors/${v.id}`, admin);
  }
  const segAfter = (((await req('GET', '/api/settings/market-segments', admin)).json as any[]) ?? []).find((s: any) => s.label === SEGMENT_LABEL);
  if (segAfter) {
    const segDel = await req('PATCH', `/api/settings/market-segments/${segAfter.id}`, admin, { is_active: false });
    check('cleanup segment', segDel.status === 200, segDel.json);
  }

  console.log(failures === 0 ? '\nSMOKE OK' : `\nSMOKE FAILURES: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SMOKE ERROR', err);
  process.exit(1);
});