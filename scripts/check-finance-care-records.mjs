import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, cloud, migration] = await Promise.all([
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "cloud-data.js"), "utf8"),
  readFile(path.join(root, "supabase/migrations/037_finance_and_care_record_corrections.sql"), "utf8"),
]);

const checks = [
  ["legacy service totals are resolved server-side", migration.includes("service_request_expected_total") && migration.includes("resolved_service_total")],
  ["balance receipt function uses the resolved total", migration.includes("expected_total := public.service_request_expected_total(request_row.id)")],
  ["babysitting meals use one unified label", app.includes('name="mealType" value="식사"') && !app.includes('<option>아침</option>')],
  ["activity memo is optional", app.includes("메모를 입력하지 않아도 선택한 이벤트 구분만으로 저장할 수 있습니다.") && !app.includes('id="sitter-note-text" name="text" placeholder="무엇을 했는지')],
  ["pumped milk uses ml input", app.includes("유축 모유와 분유는 실제 먹은 양을 ml로 입력합니다.") && app.includes('["pumped", "formula"].includes(data.method)')],
  ["new records refresh to the current device time", app.includes("requestAnimationFrame(() => setCareRecordTimeToNow")],
  ["care records expose edit controls", app.includes('data-edit-care-event="${event.id}"') && app.includes("openCareEventEditModal")],
  ["care record edits call a protected RPC", cloud.includes('supabase.rpc("update_care_event"') && migration.includes("create or replace function public.update_care_event")],
  ["care record corrections retain an audit trail", migration.includes("CORRECT_CARE_EVENT") && migration.includes("before_payload") && migration.includes("after_payload")],
  ["completed-visit records may be corrected", migration.includes("if tg_op in ('INSERT', 'DELETE') and session_row.status <> 'IN_PROGRESS'")],
];

const failures = checks.filter(([, passed]) => !passed);
if (failures.length) {
  failures.forEach(([label]) => console.error(`FAIL: ${label}`));
  process.exitCode = 1;
} else {
  console.log(`Finance and care-record checks passed (${checks.length}/${checks.length}).`);
}
